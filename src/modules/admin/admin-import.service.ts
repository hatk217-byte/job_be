import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as ExcelJS from 'exceljs';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';
import { Not, Repository } from 'typeorm';
import { Company } from '../companies/company.entity';
import { Job } from '../jobs/job.entity';
import { JobApplication } from '../jobs/job-application.entity';
import { User } from '../users/user.entity';
import { Blog } from '../blogs/blog.entity';
import { JobBenefit } from '../jobs/job-benefit.entity';
import { CompanyImage } from '../companies/company-image.entity';
import { RoleStatus } from '@/enum/role';
import {
  CATEGORY,
  EXPERIENCE_LEVEL,
  GENDER_JOB,
  GRADE,
  JOB_BENEFITS,
  LOCATION,
  ORGANIZATION_TYPE,
  REQUIRED_QUALIFICATION,
  ROLE_USER,
  SALARY_TYPE,
  TYPE_OF_EMPLOYMENT,
  resolveCommaCodes,
  resolveRoleUser,
  resolveSingleCode,
} from './import-excel-label-maps';
import { isValidMstFormat, normalizeMstDigits } from '@/common/utils/mst.util';
import { attachVbaToXlsm, tryReadVbarawBytes } from './admin-import-xlsm-vba';

type HeaderMap = Map<string, number>;

export interface AdminExcelTemplateFile {
  buffer: Buffer;
  fileName: string;
  contentType: string;
  hasMacro: boolean;
}

const LIST_SHEET = 'lists';
const USER_GENDER_OPTIONS: { code: number; label: string }[] = [
  { code: 1, label: 'male' },
  { code: 2, label: 'female' },
  { code: 3, label: 'both' },
];
const TPL_LIST_ROW_START = 2;
const TPL_DATA_ROW_END = 500;
const COMPANIES_TPL_COL_COUNT = 21;
/** id, email, …, company_id (FK), company_mst, … */
const USERS_TPL_COL_COUNT = 20;
/** id, title, …, company_id, user_id, …, email, deadline, posted_date, post_type, note */
const JOBS_TPL_COL_COUNT = 26;
const JOB_APPS_TPL_COL_COUNT = 7;
const BLOGS_TPL_COL_COUNT = 13;
const SELECT_MULTI_LABEL = '---Select-multi---';
const SELECT_SINGLE_LABEL = '---Select-single---';
type ListSelectHint = 'multi' | 'single' | 'none';

function isSelectHintValue(v: string): boolean {
  const t = v.trim();
  return !t || t === SELECT_MULTI_LABEL || t === SELECT_SINGLE_LABEL;
}

function writeLabelsColumn(
  lists: ExcelJS.Worksheet,
  col: number,
  items: { code: number; label: string }[],
  hint: ListSelectHint,
): { start: number; end: number } {
  // Hiển thị 1 nhãn hướng dẫn ở đầu mỗi list (tùy multi/single).
  // Data validation sẽ chỉ trỏ vào phần "items" (không bao gồm nhãn).
  if (hint === 'multi') lists.getRow(TPL_LIST_ROW_START).getCell(col).value = SELECT_MULTI_LABEL;
  if (hint === 'single') lists.getRow(TPL_LIST_ROW_START).getCell(col).value = SELECT_SINGLE_LABEL;

  const start = hint === 'none' ? TPL_LIST_ROW_START : TPL_LIST_ROW_START + 1;
  const end = start + items.length - 1;
  items.forEach((it, i) => {
    lists.getRow(start + i).getCell(col).value = it.label;
  });
  return { start, end };
}

function listFormula(colLetter: string, start: number, end: number, includeHint = false): string {
  // includeHint=true: phạm vi dropdown sẽ bao gồm cả dòng tag ---Select-multi--- / ---Select-single--- ở row start-1.
  const s = includeHint && start > TPL_LIST_ROW_START ? start - 1 : start;
  // Excel data validation list expects a formula/range reference (commonly with '=' prefix).
  return `=${LIST_SHEET}!$${colLetter}$${s}:$${colLetter}$${end}`;
}

type InputHint = { title: string; text: string };

function applyListValidation(
  sheet: ExcelJS.Worksheet,
  col: number,
  fromRow: number,
  toRow: number,
  formula: string,
  input?: InputHint,
): void {
  for (let r = fromRow; r <= toRow; r++) {
    sheet.getRow(r).getCell(col).dataValidation = {
      type: 'list',
      allowBlank: true,
      showErrorMessage: true,
      showInputMessage: Boolean(input),
      promptTitle: input?.title,
      prompt: input?.text,
      formulae: [formula],
    } as ExcelJS.DataValidation;
  }
}

/** Gợi ý (tooltip) trên cột nhập tự do — không giới hạn nội dung (custom: luôn hợp lệ). */
function applyInputHint(
  sheet: ExcelJS.Worksheet,
  col: number,
  fromRow: number,
  toRow: number,
  input: InputHint,
): void {
  for (let r = fromRow; r <= toRow; r++) {
    sheet.getRow(r).getCell(col).dataValidation = {
      type: 'custom',
      allowBlank: true,
      showErrorMessage: false,
      showInputMessage: true,
      promptTitle: input.title,
      prompt: input.text,
      formulae: ['=TRUE'],
    } as ExcelJS.DataValidation;
  }
}

/** Gần giống AutoFit trong Excel: rộng cột theo nội dung các ô (có trần). */
function setAutoColumnWidths(
  sheet: ExcelJS.Worksheet,
  colFrom: number,
  colTo: number,
  rowFrom: number,
  rowTo: number,
  minW = 8,
  maxW = 60,
): void {
  for (let c = colFrom; c <= colTo; c++) {
    let maxL = 0;
    for (let r = rowFrom; r <= rowTo; r++) {
      const v = sheet.getRow(r).getCell(c).value;
      const t = String(v ?? '')
        .replace(/[\n\r\t]+/g, ' ')
        .trim();
      if (t.length > maxL) maxL = t.length;
    }
    const w = Math.min(maxW, Math.max(minW, maxL * 0.8 + 2.2));
    sheet.getColumn(c).width = w;
  }
}

function setWrapTextForColumns(
  sheet: ExcelJS.Worksheet,
  cols: number[],
  rowFrom: number,
  rowTo: number,
): void {
  for (const c of cols) {
    for (let r = rowFrom; r <= rowTo; r++) {
      const cell = sheet.getRow(r).getCell(c);
      cell.alignment = {
        ...cell.alignment,
        wrapText: true,
        vertical: 'top',
      };
    }
  }
}

/** Đặt định dạng Text cho toàn bộ cột để không mất số 0 ở đầu (vd: 0123). */
function setAllColumnsText(sheet: ExcelJS.Worksheet, colCount: number): void {
  for (let c = 1; c <= colCount; c++) {
    // '@' = Text format in Excel
    sheet.getColumn(c).numFmt = '@';
  }
}

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFEE7C0' },
};

function styleDataSheet(
  sheet: ExcelJS.Worksheet,
  colCount: number,
  options?: { freezeSplit?: { xSplit: number; ySplit: number; topLeftCell: string } },
): void {
  const r1 = sheet.getRow(1);
  r1.height = 24;
  for (let c = 1; c <= colCount; c++) {
    r1.getCell(c).fill = HEADER_FILL;
    r1.getCell(c).alignment = {
      ...r1.getCell(c).alignment,
      vertical: 'middle',
      wrapText: true,
    };
  }
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: colCount },
  };
  if (options?.freezeSplit) {
    const { xSplit, ySplit, topLeftCell } = options.freezeSplit;
    sheet.views = [
      {
        state: 'frozen',
        xSplit,
        ySplit,
        topLeftCell,
        rightToLeft: false,
        activeCell: 'A1',
        showRuler: true,
        showRowColHeaders: true,
        showGridLines: true,
        zoomScale: 100,
        zoomScaleNormal: 100,
      },
    ] as ExcelJS.Worksheet['views'];
  }
}

function resolveOptionalInt(
  raw: string,
  list: { code: number; label: string }[],
  field: string,
): number | null {
  if (!raw.trim()) return null;
  const n = resolveSingleCode(raw, list, field, 0);
  return n || null;
}

/** Gộp nhiều cột (mỗi cột 1+ mã/gõ phẩy) → chuỗi mã duy nhất, tăng dần. */
function mergeListFields(
  row: ExcelJS.Row,
  h: HeaderMap,
  fieldKeys: readonly string[],
  list: { code: number; label: string }[],
  field: string,
  defaultRaw: string,
): string {
  const codes: number[] = [];
  for (const key of fieldKeys) {
    if (!h.has(key)) continue;
    const v = str(getCell(row, h, key));
    if (!v.trim()) continue;
    const part = resolveCommaCodes(v, list, field);
    for (const s of part.split(/,/)) {
      const n = parseInt(s.trim(), 10);
      if (Number.isFinite(n) && n > 0) {
        codes.push(n);
      }
    }
  }
  if (codes.length === 0) {
    return resolveCommaCodes(defaultRaw, list, field);
  }
  return [...new Set(codes)]
    .sort((a, b) => a - b)
    .join(',');
}

const JOB_CATEGORY_KEYS = [
  'category',
  'category_2',
  'category_3',
  'category_4',
] as const;
const JOB_LOCATION_KEYS = [
  'location',
  'location_2',
  'location_3',
  'location_4',
] as const;
const JOB_BENEFIT_KEYS = [
  'benefits',
  'benefit_2',
  'benefit_3',
  'benefit_4',
  'benefit_5',
] as const;

const YES_NO_OPTIONS = [
  { code: 0, label: '0' },
  { code: 1, label: '1' },
];
const JOB_STATUS_OPTIONS = [
  { code: 1, label: 'APPROVED' },
  { code: 2, label: 'ADMIN_REVIEW' },
  { code: 3, label: 'REJECTED' },
];
const BLOG_STATUS_OPTIONS = [
  { code: 1, label: 'published' },
  { code: 2, label: 'draft' },
];
const BLOG_CATEGORY_OPTIONS = [
  { code: 1, label: 'tin-tuc' },
  { code: 2, label: 'cv' },
  { code: 3, label: 'phong-van' },
  { code: 4, label: 'kinh-nghiem' },
];
const POST_TYPE_OPTIONS = [
  { code: 1, label: 'Basic' },
  { code: 2, label: 'Hot' },
  { code: 3, label: 'Urgent' },
];
const JOB_NOTE_OPTIONS = [
  { code: 1, label: 'user' },
  { code: 2, label: 'admin' },
];

function colToLetter(col: number): string {
  let n = col;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function unwrapCellValue(v: unknown): unknown {
  if (v == null) return v;
  if (typeof v === 'object' && v !== null) {
    const o = v as { result?: unknown; text?: string; richText?: unknown };
    if ('result' in o && o.result !== undefined && o.result !== null) return o.result;
    if (typeof o.text === 'string') return o.text;
  }
  return v;
}

function sheetColARange(sheet: string): string {
  const q = sheet.includes(' ') ? `'${sheet.replace(/'/g, "''")}'` : sheet;
  return `=${q}!$A$2:$A$${TPL_DATA_ROW_END}`;
}

/**
 * Cột A: id 1,2,3… theo các dòng có dữ liệu (MAX trên cột A phía trên + 1).
 * Một công thức duy nhất cho mọi dòng — copy/drag dòng trong Excel vẫn đúng (ROW() theo từng ô).
 */
function applyPkFormulaColumn(
  sheet: ExcelJS.Worksheet,
  lastDataCol: number,
  fromRow: number,
  toRow: number,
): void {
  const endL = colToLetter(lastDataCol);
  const aStart = `$A$${fromRow}`;
  const f = `IF(COUNTA(INDIRECT("B"&ROW()&":${endL}"&ROW()))<=0,"",IF(ROW()=${fromRow},1,MAX(${aStart}:INDIRECT("A"&(ROW()-1)))+1))`;
  for (let r = fromRow; r <= toRow; r++) {
    const cell = sheet.getRow(r).getCell(1);
    const hint = r === fromRow ? 1 : undefined;
    cell.value = { formula: f, result: hint } as ExcelJS.CellValue;
  }
}

function getResolvedNum(row: ExcelJS.Row, h: HeaderMap, key: string): number | null {
  const col = h.get(normHeader(key));
  if (col == null) return null;
  const raw = unwrapCellValue(row.getCell(col).value);
  const n = num(raw, NaN);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Id tạm 1,2,3… theo sheet: ưu tiên ô id (công thức); nếu trống thì tự tăng (sau clear DB / file sửa tay). */
function createProvIdAllocator(): (row: ExcelJS.Row, h: HeaderMap) => number {
  let seq = 0;
  return (row: ExcelJS.Row, h: HeaderMap) => {
    const n = getResolvedNum(row, h, 'id');
    if (n != null) {
      seq = Math.max(seq, n);
      return n;
    }
    seq += 1;
    return seq;
  };
}

export type AdminImportDataMode = 'clear' | 'keep';

/** Id cột A trong Excel là id tạm — khi giữ data cũ không được fallback sang id DB trùng số. */
async function resolveImportFkId(
  excelId: number,
  provMap: Map<number, number>,
  keepExistingData: boolean,
  findByDbId: () => Promise<{ id: number } | null>,
): Promise<number | null> {
  const mapped = provMap.get(excelId);
  if (mapped != null) return mapped;
  if (keepExistingData) return null;
  const found = await findByDbId();
  if (found) {
    provMap.set(excelId, found.id);
    return found.id;
  }
  return null;
}

function normalizeImportEmail(email: string): string {
  return email.trim().toLowerCase();
}

function resolveImportUserRoleFromCode(roleCode: number): RoleStatus {
  if (roleCode === RoleStatus.ADMIN) return RoleStatus.ADMIN;
  if (roleCode === RoleStatus.COMPANY) return RoleStatus.COMPANY;
  return RoleStatus.USER;
}

function buildExcelUserLookups(wb: ExcelJS.Workbook): {
  provIdToRole: Map<number, RoleStatus>;
  provIdToEmail: Map<number, string>;
} {
  const provIdToRole = new Map<number, RoleStatus>();
  const provIdToEmail = new Map<number, string>();
  const ws = wb.getWorksheet('users') ?? wb.getWorksheet('USERS');
  if (!ws) return { provIdToRole, provIdToEmail };

  const h = buildHeaderMap(ws, 1);
  if (h.size === 0) return { provIdToRole, provIdToEmail };

  const allocProvId = createProvIdAllocator();
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (!rowHasImportableData('users', row, h)) continue;

    const provId = allocProvId(row, h);
    const roleCode = resolveRoleUser(str(getCell(row, h, 'role')), RoleStatus.USER);
    provIdToRole.set(provId, resolveImportUserRoleFromCode(roleCode));

    const email = str(getCell(row, h, 'email'));
    if (email) provIdToEmail.set(provId, normalizeImportEmail(email));
  }

  return { provIdToRole, provIdToEmail };
}

function formatJobUserNotFoundError(
  ctx: string,
  h: HeaderMap,
  rowIndex: number,
  excelUserId: number | null,
  jobEmail: string,
  excelEmailToUserId: Map<string, number>,
): string {
  const userIdCell = getCellByField(h, rowIndex, 'user_id');
  const emailCell = getCellByField(h, rowIndex, 'email');
  const prefix = `${ctx}${userIdCell ? `: cell ${userIdCell}` : ''}`;
  const details: string[] = [];

  if (excelUserId != null) {
    details.push(`user_id=${excelUserId} không map được tới user trong file import`);
  } else {
    details.push('thiếu user_id');
  }

  const trimmedEmail = jobEmail.trim();
  if (!trimmedEmail) {
    details.push('cột email (liên hệ tin) trống nên không thể gán user theo email');
  } else {
    const excelEmails = [...excelEmailToUserId.keys()];
    details.push(
      `email liên hệ "${trimmedEmail}" không khớp user nào trong sheet users của file` +
        (excelEmails.length
          ? ` (có ${excelEmails.length} email user trong file, vd: ${excelEmails.slice(0, 3).join(', ')})`
          : ' (chưa có user nào được ghi nhận từ sheet users trong lần import này)'),
    );
    details.push(`email "${trimmedEmail}" cũng không tồn tại trong DB`);
    if (emailCell) {
      details.push(`hãy kiểm tra ${emailCell} khớp email user hoặc ${userIdCell ?? 'user_id'} khớp id tạm cột A sheet users`);
    }
  }

  return `${prefix}: không tìm thấy user — ${details.join('; ')}`;
}

function rowHasImportableData(
  name: 'companies' | 'users' | 'jobs' | 'job_applications' | 'blogs',
  row: ExcelJS.Row,
  h: HeaderMap,
): boolean {
  const pick = (keys: string[]) => keys.some((k) => str(getCell(row, h, k)) !== '');
  if (name === 'companies') return pick(['name', 'mst']);
  if (name === 'users') return pick(['email', 'username']);
  if (name === 'jobs') return pick(['title', 'company_id', 'user_id']);
  if (name === 'job_applications')
    return pick(['applicant_email', 'job_title', 'company_mst', 'job_id', 'user_id']);
  return pick(['title']);
}

function getCellByField(h: HeaderMap, rowIndex: number, fieldKey: string): string | null {
  const col = h.get(normHeader(fieldKey));
  if (!col) return null;
  return `${colToLetter(col)}${rowIndex}`;
}

function parseResolverFieldFromMessage(msg: string): string | null {
  const m = /^([a-zA-Z0-9_]+):\s*/.exec(msg.trim());
  return m?.[1] ?? null;
}

function normHeader(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function buildHeaderMap(worksheet: ExcelJS.Worksheet, headerRow: number): HeaderMap {
  const r = worksheet.getRow(headerRow);
  const m: HeaderMap = new Map();
  r.eachCell({ includeEmpty: false }, (cell, col) => {
    m.set(normHeader(cell.value), col);
  });
  return m;
}

function getCell(
  row: ExcelJS.Row,
  h: HeaderMap,
  key: string,
): string | number | null | undefined {
  const col = h.get(key);
  if (col == null) return undefined;
  const v = unwrapCellValue(row.getCell(col).value);
  if (v == null) return null;
  if (typeof v === 'object' && v !== null && 'text' in (v as any)) {
    return String((v as { text: string }).text);
  }
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return String(v);
}

function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function num(v: unknown, d = 0): number {
  if (v == null) return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function toBool01(v: unknown, defaultVal = false): boolean {
  if (v == null) return defaultVal;
  if (typeof v === 'boolean') return v;
  const s = str(v).toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'y') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'n' || s === '') return false;
  return defaultVal;
}

function parseDateVal(v: unknown): Date {
  if (v == null) return new Date();
  if (v instanceof Date) return v;
  const s = str(v);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function slugifyTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\u00C0-\u024F\u1E00-\u1EFF]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'blog'
  );
}

/** Bảng mã tham chiếu (đồng bộ FE master data) — sheet note */
const EXCEL_NOTE_MASTERDATA: [string, string][] = [
  [
    'Danh mục (category)',
    'Trường category trong jobs: ghi mã số (có thể nhiều mã cách nhau bởi dấu phẩy, ví dụ 4 hoặc 4,5). Mã: 1=Giáo viên mầm non; 2=Tiểu học; 3=Ngữ văn; 4=Toán; 5=Tiếng Anh; 6=GDCD; 7=Lịch sử; 8=Địa lí; 9=Khoa học tự nhiên; 10=Công nghệ; 11=Tin học; 12=Thể chất; 13=Nghệ thuật; 14=Hoạt động trải nghiệm; 15=Vật lý; 16=Hóa học; 17=GD địa phương; 18=Tiếng Pháp; 19=Tiếng Đức; 20=Tiếng Nga; 21=Tiếng Nhật; 22=Tiếng Hàn; 23=Tiếng Trung; 24=Tiếng TBN; 25=STEM; 26=Trợ giảng; 27=Trợ giảng tiếng Anh; 28=Trợ giảng toán.',
  ],
  [
    'Địa điểm (location)',
    'Trường location trong jobs: mã tỉnh/thành (chuỗi số hoặc nhiều mã cách phẩy). 1=Tuyên Quang; 2=Cao Bằng; 3=Lai Châu; 4=Lào Cai; 5=Thái Nguyên; 6=Điện Biên; 7=Lạng Sơn; 8=Sơn La; 9=Phú Thọ; 10=Bắc Ninh; 11=Quảng Ninh; 12=Hà Nội; 13=Hải Phòng; 14=Hưng Yên; 15=Ninh Bình; 16=Thanh Hóa; 17=Nghệ An; 18=Hà Tĩnh; 19=Quảng Trị; 20=Huế; 21=Đà Nẵng; 22=Quảng Ngãi; 23=Gia Lai; 24=Đắk Lắk; 25=Khánh Hòa; 26=Lâm Đồng; 27=Đồng Nai; 28=Tây Ninh; 29=TP.HCM; 30=Đồng Tháp; 31=An Giang; 32=Vĩnh Long; 33=Cần Thơ; 34=Cà Mau.',
  ],
  [
    'Hình thức (type_of_employment)',
    'Cột type_of_employment: 1=Thực tập sinh; 2=Toàn thời gian; 3=Bán thời gian; 4=Remote; 5=Tạm thời/dự án.',
  ],
  [
    'Loại lương (salary_type)',
    'Cột salary_type: 1=Tháng; 2=Tuần; 3=Giờ; 4=Theo hợp đồng dự án; 5=Thương lượng.',
  ],
  [
    'Loại hình tổ chức (organization_type)',
    'Sheet companies, cột organization_type: 1=Trường công lập; 2=Trường tư thục; 3=Trường quốc tế; 4=Trường công giáo; 5=Trung tâm; 6=Trường GD đặc biệt; 7=Trường dạy nghề; 8=Khác.',
  ],
  [
    'Kinh nghiệm (experience_level)',
    'Cột experience_level (tùy chọn): 1=Dưới 1 năm; 2=2 năm; 3=3 năm; 4=4 năm; 5=5 năm; 6=6 năm+; 7=Không yêu cầu.',
  ],
  [
    'Cấp dạy (grade)',
    'Cột grade (tùy chọn): 1=Mầm non; 2=Tiểu học; 3=THCS; 4=PTTH; 5=Cao đẳng; 6=Đại học; 7=Sau ĐH; 8=Khác.',
  ],
  [
    'Trình độ (required_qualification)',
    'Cột required_qualification (tùy chọn, multi): nhiều mã cách phẩy. 1=Chưa tốt nghiệp; 2=Cao đẳng; 3=Đại học; 4=Sư phạm; 5=Thạc sĩ; 6=Phó tiến sĩ; 7=Tiến sĩ.',
  ],
  [
    'Giới tính (gender) — job',
    'Cột gender trong jobs (multi): mã chuỗi (vd 1, 2 hoặc 1,2): 1=Nam; 2=Nữ.',
  ],
  [
    'Phúc lợi (benefits)',
    'Cột benefits: nhiều mã cách phẩy. 1=Bảo hiểm; 2=Du lịch; 3=Thưởng; 4=Chăm sóc SK; 5=Đào tạo; 6=Tăng lương; 7=Laptop; 8=Ăn trưa; 9=Đi lại; 10=Nghỉ phép có lương; 11=Nhà ở; 12=Đồng phục; 13=Teambuilding; 14=Thưởng hiệu suất; 15=Khám SK định kỳ.',
  ],
];

export interface AdminImportResultDto {
  summary: {
    companies: number;
    users: number;
    jobs: number;
    jobApplications: number;
    blogs: number;
  };
  errors: string[];
}

@Injectable()
export class AdminImportService {
  private readonly log = new Logger(AdminImportService.name);

  constructor(
    @InjectRepository(Company) private readonly companyRepository: Repository<Company>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Job) private readonly jobRepository: Repository<Job>,
    @InjectRepository(JobApplication)
    private readonly jobApplicationRepository: Repository<JobApplication>,
    @InjectRepository(Blog) private readonly blogRepository: Repository<Blog>,
    @InjectRepository(JobBenefit) private readonly jobBenefitRepository: Repository<JobBenefit>,
    @InjectRepository(CompanyImage)
    private readonly companyImageRepository: Repository<CompanyImage>,
  ) {}

  private async seedExistingImportLookups(
    mstToCompanyId: Map<string, number>,
    emailToUserId: Map<string, number>,
  ): Promise<void> {
    const companies = await this.companyRepository.find({ select: ['id', 'mst'] });
    for (const c of companies) {
      if (c.mst) mstToCompanyId.set(c.mst, c.id);
    }
    const users = await this.userRepository.find({ select: ['id', 'email'] });
    for (const u of users) {
      if (u.email) {
        emailToUserId.set(u.email, u.id);
        emailToUserId.set(normalizeImportEmail(u.email), u.id);
      }
    }
  }

  private async resolveJobImportUserId(
    excelUserId: number | null,
    jobEmailRaw: string,
    provUserIdToDbId: Map<number, number>,
    excelEmailToUserId: Map<string, number>,
    emailToUserId: Map<string, number>,
    keepExistingData: boolean,
  ): Promise<number | null> {
    let userId = 0;

    if (excelUserId != null) {
      const resolved = await resolveImportFkId(
        excelUserId,
        provUserIdToDbId,
        keepExistingData,
        () => this.userRepository.findOne({ where: { id: excelUserId } }),
      );
      if (resolved) userId = resolved;
    }

    const jobEmail = jobEmailRaw.trim();
    if (!userId && jobEmail) {
      const fromExcel = excelEmailToUserId.get(normalizeImportEmail(jobEmail));
      if (fromExcel) userId = fromExcel;
    }

    if (!userId && jobEmail) {
      const normalized = normalizeImportEmail(jobEmail);
      const cached = emailToUserId.get(jobEmail) ?? emailToUserId.get(normalized);
      if (cached) {
        userId = cached;
      } else {
        const u = await this.userRepository
          .createQueryBuilder('u')
          .where('LOWER(u.email) = :email', { email: normalized })
          .getOne();
        if (u) {
          userId = u.id;
          emailToUserId.set(u.email, u.id);
          emailToUserId.set(normalized, u.id);
        }
      }
    }

    return userId || null;
  }

  private async resolveUserRoleForJobImport(
    excelUserId: number,
    lookups: {
      provIdToRole: Map<number, RoleStatus>;
      provIdToEmail: Map<number, string>;
    },
  ): Promise<RoleStatus | null> {
    const sheetEmail = lookups.provIdToEmail.get(excelUserId);
    if (sheetEmail) {
      const dbByEmail = await this.userRepository
        .createQueryBuilder('u')
        .select(['u.id', 'u.role'])
        .where('LOWER(u.email) = :email', { email: sheetEmail })
        .getOne();
      if (dbByEmail) return dbByEmail.role;
    }

    const fromSheet = lookups.provIdToRole.get(excelUserId);
    if (fromSheet != null) return fromSheet;

    const dbById = await this.userRepository.findOne({
      where: { id: excelUserId },
      select: ['id', 'role'],
    });
    return dbById?.role ?? null;
  }

  private formatJobCandidateUserError(
    ctx: string,
    h: HeaderMap,
    rowIndex: number,
    excelUserId: number,
  ): string {
    const userIdCell = getCellByField(h, rowIndex, 'user_id');
    return `${ctx}${userIdCell ? `: cell ${userIdCell}` : ''}: user_id=${excelUserId} thuộc ứng viên (role USER) — không thể đăng job`;
  }

  /**
   * Xóa toàn bộ dữ liệu thuộc phạm vi import (trừ user role ADMIN).
   * Thứ tự xóa theo FK: job_benefit → job_applications → jobs → blogs → company_images → users (non-admin) → companies.
   */
  private async clearAllDataBeforeExcelImport(): Promise<void> {
    await this.jobBenefitRepository.createQueryBuilder().delete().from(JobBenefit).execute();
    await this.jobApplicationRepository.createQueryBuilder().delete().from(JobApplication).execute();
    await this.jobRepository.createQueryBuilder().delete().from(Job).execute();
    await this.blogRepository.createQueryBuilder().delete().from(Blog).execute();
    await this.companyImageRepository.createQueryBuilder().delete().from(CompanyImage).execute();
    await this.userRepository.createQueryBuilder().update(User).set({ companyId: null }).execute();
    await this.userRepository.delete({ role: Not(RoleStatus.ADMIN) });
    await this.companyRepository.createQueryBuilder().delete().from(Company).execute();
    this.log.warn('Đã xóa dữ liệu cũ (companies, users không phải ADMIN, jobs, …) trước khi import Excel.');
  }

  /** Trả về file template cố định đặt sẵn trong assets (ưu tiên .xlsm). */
  async getStaticImportTemplateFile(): Promise<AdminExcelTemplateFile> {
    const candidates = [
      {
        fileName: 'mau-import-tuyengiaovien.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        hasMacro: false,
      },
      {
        fileName: 'mau-import-tuyengiaovien.xlsm',
        contentType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
        hasMacro: true,
      },
    ];

    const roots = [
      path.join(__dirname, 'assets'),
      path.join(process.cwd(), 'src', 'modules', 'admin', 'assets'),
    ];

    for (const root of roots) {
      for (const candidate of candidates) {
        const fullPath = path.join(root, candidate.fileName);
        try {
          if (!fs.existsSync(fullPath)) continue;
          const stat = fs.statSync(fullPath);
          if (!stat.isFile() || stat.size <= 0) continue;
          return {
            buffer: fs.readFileSync(fullPath),
            fileName: candidate.fileName,
            contentType: candidate.contentType,
            hasMacro: candidate.hasMacro,
          };
        } catch {
          // Bỏ qua và thử candidate tiếp theo.
        }
      }
    }

    throw new BadRequestException(
      'Không tìm thấy template tĩnh. Hãy đặt file mau-import-tuyengiaovien.xlsm hoặc mau-import-tuyengiaovien.xlsx trong src/modules/admin/assets.',
    );
  }

  /** Tạo mẫu .xlsx; nếu có assets/vbaraw.bin sẽ gắn VBA (SheetJS) → .xlsm. */
  async buildImportExcelTemplate(): Promise<AdminExcelTemplateFile> {
    const vbaraw = tryReadVbarawBytes();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'TuyenGiaoVien';

    const lists = wb.addWorksheet(LIST_SHEET);
    lists.getRow(1).values = [
      'category',
      'location',
      'type_emp',
      'salary',
      'org',
      'exp',
      'grade',
      'qual',
      'gender',
      'benefit',
      'role',
      'bool01',
      'job_status',
      'blog_status',
      'blog_category',
      'user_gender',
      'post_type',
      'job_note',
    ];
    // Multi-select dùng VBA/gõ nhiều mã trong cùng ô: category/location/benefits.
    const listCat = writeLabelsColumn(lists, 1, CATEGORY, 'multi');
    // Giữ như cũ: location cũng là list "multi" để hint ở B2 là ---Select-multi---.
    // Riêng users.location sẽ lấy từ B3 (không lấy hint), còn các sheet khác có thể lấy từ B2.
    const listLoc = writeLabelsColumn(lists, 2, LOCATION, 'multi');
    const listTypeEmp = writeLabelsColumn(lists, 3, TYPE_OF_EMPLOYMENT, 'single');
    const listSalary = writeLabelsColumn(lists, 4, SALARY_TYPE, 'single');
    const listOrg = writeLabelsColumn(lists, 5, ORGANIZATION_TYPE, 'single');
    const listExp = writeLabelsColumn(lists, 6, EXPERIENCE_LEVEL, 'single');
    const listGrade = writeLabelsColumn(lists, 7, GRADE, 'single');
    const listQual = writeLabelsColumn(lists, 8, REQUIRED_QUALIFICATION, 'multi');
    // jobs.gender: multi (để gõ/chọn nhiều giá trị nếu cần)
    const listGender = writeLabelsColumn(lists, 9, GENDER_JOB, 'multi');
    const listBenefit = writeLabelsColumn(lists, 10, JOB_BENEFITS, 'multi');
    const listRole = writeLabelsColumn(lists, 11, ROLE_USER, 'single');
    const listBool01 = writeLabelsColumn(lists, 12, YES_NO_OPTIONS, 'single');
    const listJobStatus = writeLabelsColumn(lists, 13, JOB_STATUS_OPTIONS, 'single');
    const listBlogStatus = writeLabelsColumn(lists, 14, BLOG_STATUS_OPTIONS, 'single');
    const listBlogCategory = writeLabelsColumn(lists, 15, BLOG_CATEGORY_OPTIONS, 'single');
    const listUserGender = writeLabelsColumn(lists, 16, USER_GENDER_OPTIONS, 'single');
    const listPostType = writeLabelsColumn(lists, 17, POST_TYPE_OPTIONS, 'single');
    const listJobNote = writeLabelsColumn(lists, 18, JOB_NOTE_OPTIONS, 'single');
    lists.getRow(1).font = { bold: true };
    lists.state = 'hidden';

    const note = wb.addWorksheet('note', {
      properties: { tabColor: { argb: 'FF6366F1' } },
    });
    note.addRow(['Mục', 'Ghi chú & kiểu dữ liệu']);
    const noteRows: [string, string][] = [
      vbaraw
        ? [
            'Macro: chọn nhiều (1ô)',
            'Bản tải về sẽ là .xlsm (có VBA khi server có vbaraw.bin). Khi mở: Bật nội dung (Enable Content). Ở sheet "jobs": cột 4 (category), 5 (location), 16 (required_qualification), 17 (gender), 18 (benefits): mỗi lần chọn từ thả xuống, giá trị sẽ nối cách phẩy trong cùng ô.',
          ]
        : [
            'Macro (tùy chọn)',
            'Để tải bản .xlsm hỗ trợ nối nhiều mục trong 1ô, đặt vbaraw.bin hoặc file mau-import-tuyengiaovien.xlsm trong assets. Không bắt buộc: gõ nhiều mã/nhãn cách phẩy trong cùng ô.',
          ],
      [
        'Bắt đầu nhanh',
        '1) companies → 2) users → 3) jobs → sheet khác. Dòng 1 = tiêu đề, dữ liệu từ dòng 2. Cột A: id tạm 1, 2, 3… Trên "jobs": multi-select ở category (4), location (5), required_qualification (16), gender (17), benefits (18).',
      ],
      [
        'Khóa & tham chiếu trong file',
        'company_id / user_id / job_id là id tạm trùng cột A sheet cha (cùng file). Import ưu tiên các cột *_id; job_applications cũ có thể dùng job_title + company_mst.',
      ],
      [
        'Chung',
        'Dòng 1 = tên cột (tiêu đề), dữ liệu từ dòng 2. Tên cột: chữ thường, dấu gạch dưới. Dòng trống = bỏ qua.',
      ],
      [
        'Thứ tự import',
        'Nên theo: companies → users → jobs → job_applications → blogs. Jobs: company_id + user_id (dropdown).',
      ],
      [
        'Sheet lists (ẩn)',
        'Nhãn tham chiếu + nguồn cho cột dùng dropdown (đơn): category, location, type_emp, salary, org, exp, grade, qual, gender, benefit, role, bool01, job_status, blog_status, blog_category.',
      ],
      [
        'companies',
        'Không có cột email (email NTD nằm ở sheet users). organization_type: số/nhãn (lists cột org). 0/1: is_waiting, is_featured. company_size, founded_year: số. Còn lại: name, mst, địa chỉ, link…',
      ],
      [
        'users',
        'role: 1/2/3, nhãn (USER/ADMIN/COMPANY) hoặc từ dropdown. 0/1: is_host_company, is_active. Mật khẩu: chuỗi (sẽ được mã hóa). company_id: dropdown id công ty (sheet companies cột A); hoặc company_mst.',
      ],
      [
        'Cột nhiều mã (jobs)',
        'Chọn nhiều danh mục/địa điểm/trình độ/giới tính/phúc lợi bằng cách nhập/gõ nhiều mã cách phẩy trong 1ô (hoặc dùng VBA trong file .xlsm). Hệ thống gộp và bỏ trùng, lưu mã nối bằng dấu phẩy.',
      ],
      [
        'jobs',
        'Multi: cột 4 category, 5 location, 16 required_qualification, 17 gender, 18 benefits. Bắt buộc: company_id (7), user_id (8) — dropdown sheet companies/users. Tùy chọn: email (22, liên hệ tin — trùng cột jobs.email DB), deadline (23), posted_date (24), post_type (25), note (26).',
      ],
      [
        'job_applications',
        'Ưu tiên job_id + user_id (dropdown từ jobs/users cột A). Hoặc applicant_email + job_title + company_mst như cũ. Có thể thêm: resume_path, cover_letter_text, cover_letter_url.',
      ],
      [
        'blogs',
        'Hầu hết chuỗi. display_on_homepage (nếu thêm cột): 0/1. image: URL. url: slug — nên duy nhất; để trống hệ thống tạo tự động.',
      ],
      ['———', '——— BẢNG MÃ THAM CHIẾU (dùng khi điền cột số) ———'],
      ...EXCEL_NOTE_MASTERDATA,
    ];
    noteRows.forEach((r) => note.addRow(r));
    note.getRow(1).font = { bold: true };
    note.eachRow((row) => {
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' as const };
    });

    const c = wb.addWorksheet('companies', {
      properties: { tabColor: { argb: 'FF3563FF' } },
    });
    c.addRow([
      'id',
      'name',
      'mst',
      'website',
      'address',
      'tax_address',
      'organization_type',
      'company_size',
      'founded_year',
      'is_waiting',
      'is_featured',
      'logo',
      'description',
      'facebook_link',
      'twitter_link',
      'linkedin_link',
      'instagram_link',
      'insight',
      'overview',
      'banner_image',
      'video_url',
    ]);
    c.addRow([
      '',
      'Trường mẫu A',
      '0123456789',
      'https://example.com',
      'Hà Nội',
      '',
      SELECT_SINGLE_LABEL,
      50,
      2010,
      SELECT_SINGLE_LABEL,
      SELECT_SINGLE_LABEL,
      'https://placehold.co/200x200',
      'Mô tả công ty (text).',
      'https://facebook.com/example',
      'https://twitter.com/example',
      'https://linkedin.com/company/example',
      'https://instagram.com/example',
      'Insight (text).',
      'Overview (text).',
      'https://placehold.co/1200x400',
      'https://example.com/video',
    ]);

    const u = wb.addWorksheet('users', {
      properties: { tabColor: { argb: 'FF10B981' } },
    });
    u.addRow([
      'id',
      'email',
      'username',
      'password',
      'full_name',
      'role',
      'phone_number',
      'location',
      'expertise',
      'gender',
      'company_id',
      'is_host_company',
      'is_active',
      'cv_url',
      'cv_file_name',
      'cover_letter_url',
      'cover_letter_text',
      'cover_letter_file_name',
      'avatar_url',
      'avatar_file_name',
    ]);
    u.addRow([
      '',
      'user@example.com',
      'userimport01',
      'ChangeMe123!',
      'Nguyễn Văn A',
      SELECT_SINGLE_LABEL,
      '0900000000',
      SELECT_SINGLE_LABEL,
      SELECT_MULTI_LABEL,
      SELECT_SINGLE_LABEL,
      1,
      SELECT_SINGLE_LABEL,
      SELECT_SINGLE_LABEL,
      'https://example.com/cv.pdf',
      'cv-nguyen-van-a.pdf',
      'https://example.com/cover-letter.pdf',
      'Em quan tâm vị trí này vì...',
      'cover-letter-nguyen-van-a.pdf',
      'https://placehold.co/200x200',
      'avatar-nguyen-van-a.jpg',
    ]);

    const j = wb.addWorksheet('jobs', {
      properties: { tabColor: { argb: 'FFF59E0B' } },
    });
    j.addRow([
      'id',
      'title',
      'detail_description',
      'category',
      'location',
      'type_of_employment',
      'company_id',
      'user_id',
      'salary_min',
      'salary_max',
      'salary_type',
      'address',
      'status',
      'experience_level',
      'grade',
      'required_qualification',
      'gender',
      'benefits',
      'image_logo',
      'banner_logo',
      'phone_number',
      'email',
      'deadline',
      'posted_date',
      'post_type',
      'note',
    ]);
    j.addRow([
      '',
      'Giáo viên Toán (mẫu)',
      '<p>Mô tả chi tiết công việc (HTML).</p>',
      SELECT_MULTI_LABEL,
      SELECT_MULTI_LABEL,
      SELECT_SINGLE_LABEL,
      1,
      1,
      10000000,
      20000000,
      SELECT_SINGLE_LABEL,
      'Hà Nội',
      SELECT_SINGLE_LABEL,
      SELECT_SINGLE_LABEL,
      SELECT_SINGLE_LABEL,
      SELECT_MULTI_LABEL,
      SELECT_MULTI_LABEL,
      SELECT_MULTI_LABEL,
      'https://placehold.co/200x200',
      'https://placehold.co/1200x400',
      '0900000000',
      'contact@example.com',
      '2026-12-31',
      '',
      SELECT_SINGLE_LABEL,
      SELECT_SINGLE_LABEL,
    ]);

    const ja = wb.addWorksheet('job_applications', {
      properties: { tabColor: { argb: 'FFEC4899' } },
    });
    ja.addRow([
      'id',
      'job_id',
      'user_id',
      'applicant_email',
      'resume_path',
      'cover_letter_text',
      'cover_letter_url',
    ]);
    ja.addRow(['', 1, 1, 'user@example.com', 'https://example.com/resume.pdf', '', '']);

    const b = wb.addWorksheet('blogs', {
      properties: { tabColor: { argb: 'FF8B5CF6' } },
    });
    b.addRow([
      'id',
      'title',
      'content',
      'description',
      'image',
      'url',
      'author',
      'status',
      'category',
      'display_on_homepage',
      'title_seo',
      'meta_description',
      'schema',
    ]);
    b.addRow([
      '',
      'Bài mẫu',
      'Nội dung bài (HTML text đơn giản).',
      'Mô tả ngắn',
      'https://placehold.co/800x400',
      'bai-mau',
      'Admin',
      SELECT_SINGLE_LABEL,
      SELECT_SINGLE_LABEL,
      SELECT_SINGLE_LABEL,
      'Bài mẫu - Title SEO',
      'Meta description (SEO)',
      '{"@context":"https://schema.org"}',
    ]);

    applyListValidation(
      c,
      7,
      2,
      TPL_DATA_ROW_END,
      listFormula('E', listOrg.start, listOrg.end, true),
      {
        title: 'Loại hình tổ chức',
        text: 'Chọn 1 mục từ list. Có thể gõ số 1–8 hoặc nhãn tương ứng.',
      },
    );
    for (const col of [10, 11]) {
      applyListValidation(c, col, 2, TPL_DATA_ROW_END, listFormula('L', listBool01.start, listBool01.end, true), {
        title: 'Cờ bật/tắt',
        text: 'Chọn 0 hoặc 1 (cũng có thể tự gõ 0/1).',
      });
    }
    applyListValidation(
      u,
      6,
      2,
      TPL_DATA_ROW_END,
      listFormula('K', listRole.start, listRole.end, true),
      {
        title: 'Vai trò',
        text: 'Chọn 1: Ứng viên, Quản trị, hoặc Nhà tuyển dụng.',
      },
    );
    // location list source phải bắt đầu từ B3 (không lấy dòng hint ở B2)
    applyListValidation(u, 8, 2, TPL_DATA_ROW_END, listFormula('B', listLoc.start, listLoc.end, false), {
      title: 'location',
      text: 'Chọn 1 tỉnh/thành từ danh sách.',
    });
    applyListValidation(u, 9, 2, TPL_DATA_ROW_END, listFormula('A', listCat.start, listCat.end, true), {
      title: 'expertise',
      text: 'Chọn chuyên môn (có thể chọn nhiều bằng cách nhập nhiều mục cách dấu phẩy).',
    });
    applyListValidation(u, 10, 2, TPL_DATA_ROW_END, listFormula('P', listUserGender.start, listUserGender.end, true), {
      title: 'gender',
      text: 'Chọn: male, female, hoặc both.',
    });
    applyListValidation(u, 11, 2, TPL_DATA_ROW_END, sheetColARange('companies'), {
      title: 'company_id',
      text: 'Chọn id công ty (cột A sheet companies), hoặc để trống và dùng company_mst.',
    });
    for (const col of [12, 13]) {
      applyListValidation(u, col, 2, TPL_DATA_ROW_END, listFormula('L', listBool01.start, listBool01.end, true), {
        title: 'Cờ bật/tắt',
        text: 'Chọn 0 hoặc 1 (cũng có thể tự gõ 0/1).',
      });
    }
    const catListOpts = {
      title: 'Danh mục dạy',
      text: 'Chọn danh mục cho cột category (có thể chọn nhiều bằng VBA hoặc gõ nhiều mã/nhãn cách phẩy trong 1 ô).',
    };
    const locListOpts = {
      title: 'Tỉnh/Thành phố',
      text: 'Chọn địa điểm cho cột location (có thể chọn nhiều bằng VBA hoặc gõ nhiều mã/nhãn cách phẩy trong 1 ô).',
    };
    const benListOpts = {
      title: 'Phúc lợi',
      text: 'Chọn phúc lợi cho cột benefits (có thể chọn nhiều bằng VBA hoặc gõ nhiều mã/nhãn cách phẩy trong 1 ô).',
    };
    const qualListOpts = {
      title: 'Trình độ yêu cầu',
      text: 'Chọn trình độ cho cột required_qualification (có thể chọn nhiều bằng VBA hoặc gõ nhiều mã/nhãn cách phẩy trong 1 ô).',
    };
    const genderListOpts = {
      title: 'Giới tính (tin)',
      text: 'Chọn giới tính cho cột gender (có thể chọn nhiều bằng VBA hoặc gõ nhiều mã/nhãn cách phẩy trong 1 ô).',
    };
    // Multi-select dùng VBA hoặc gõ nhiều mã cách phẩy trong cùng 1 ô,
    // nên chỉ giữ lại cột list đầu tiên cho category/location/benefits.
    applyListValidation(
      j,
      4, // category
      2,
      TPL_DATA_ROW_END,
      listFormula('A', listCat.start, listCat.end, true),
      catListOpts,
    );
    applyListValidation(
      j,
      5, // location
      2,
      TPL_DATA_ROW_END,
      // jobs.location lấy từ B2 (bao gồm hint)
      listFormula('B', listLoc.start, listLoc.end, true),
      locListOpts,
    );
    applyListValidation(
      j,
      6, // type_of_employment
      2,
      TPL_DATA_ROW_END,
      listFormula('C', listTypeEmp.start, listTypeEmp.end, true),
      {
        title: 'Hình thức làm việc',
        text: 'Chọn 1: thực tập, toàn thời gian, bán thời gian, remote, tạm thời/ dự án.',
      },
    );
    applyListValidation(j, 7, 2, TPL_DATA_ROW_END, sheetColARange('companies'), {
      title: 'company_id',
      text: 'Chọn id công ty (cột A sheet companies).',
    });
    applyListValidation(j, 8, 2, TPL_DATA_ROW_END, sheetColARange('users'), {
      title: 'user_id',
      text: 'Chọn id user (cột A sheet users).',
    });
    applyListValidation(
      j,
      11, // salary_type
      2,
      TPL_DATA_ROW_END,
      listFormula('D', listSalary.start, listSalary.end, true),
      {
        title: 'Cách tính lương',
        text: 'Chọn 1: tháng, tuần, giờ, theo dự án, thương lượng.',
      },
    );
    applyListValidation(
      j,
      13, // status
      2,
      TPL_DATA_ROW_END,
      listFormula('M', listJobStatus.start, listJobStatus.end, true),
      {
        title: 'Trạng thái tin',
        text: 'Chọn 1: APPROVED, ADMIN_REVIEW, REJECTED.',
      },
    );
    applyListValidation(
      j,
      14, // experience_level
      2,
      TPL_DATA_ROW_END,
      listFormula('F', listExp.start, listExp.end, true),
      {
        title: 'Kinh nghiệm',
        text: 'Chọn 1 từ list (có thể gõ số 1–7).',
      },
    );
    applyListValidation(
      j,
      15, // grade
      2,
      TPL_DATA_ROW_END,
      listFormula('G', listGrade.start, listGrade.end, true),
      {
        title: 'Cấp dạy',
        text: 'Chọn 1: mầm non, tiểu học, trung học, … (hoặc số 1–8).',
      },
    );
    applyListValidation(
      j,
      16, // required_qualification
      2,
      TPL_DATA_ROW_END,
      listFormula('H', listQual.start, listQual.end, true),
      qualListOpts,
    );
    applyListValidation(
      j,
      17, // gender
      2,
      TPL_DATA_ROW_END,
      listFormula('I', listGender.start, listGender.end, true),
      genderListOpts,
    );
    applyListValidation(
      j,
      18, // benefits
      2,
      TPL_DATA_ROW_END,
      listFormula('J', listBenefit.start, listBenefit.end, true),
      benListOpts,
    );
    applyListValidation(
      j,
      25, // post_type
      2,
      TPL_DATA_ROW_END,
      listFormula('Q', listPostType.start, listPostType.end, true),
      {
        title: 'Loại tin',
        text: 'Chọn 1: Basic (cơ bản), Hot (mới nhất), Urgent (tuyển gấp).',
      },
    );
    applyListValidation(
      j,
      26, // note
      2,
      TPL_DATA_ROW_END,
      listFormula('R', listJobNote.start, listJobNote.end, true),
      {
        title: 'Ghi chú nguồn',
        text: 'Chọn user hoặc admin.',
      },
    );
    applyListValidation(ja, 2, 2, TPL_DATA_ROW_END, sheetColARange('jobs'), {
      title: 'job_id',
      text: 'Chọn id tin (cột A sheet jobs), hoặc để trống và dùng job_title + company_mst.',
    });
    applyListValidation(ja, 3, 2, TPL_DATA_ROW_END, sheetColARange('users'), {
      title: 'user_id',
      text: 'Chọn id user (cột A sheet users), hoặc để trống và dùng applicant_email.',
    });
    applyListValidation(
      b,
      8,
      2,
      TPL_DATA_ROW_END,
      listFormula('N', listBlogStatus.start, listBlogStatus.end, true),
      {
        title: 'Trạng thái blog',
        text: 'Chọn published hoặc draft.',
      },
    );
    applyListValidation(
      b,
      9,
      2,
      TPL_DATA_ROW_END,
      listFormula('O', listBlogCategory.start, listBlogCategory.end, true),
      {
        title: 'Danh mục blog',
        text: 'Chọn 1: tin-tuc, cv, phong-van, kinh-nghiem.',
      },
    );
    applyListValidation(
      b,
      10,
      2,
      TPL_DATA_ROW_END,
      listFormula('L', listBool01.start, listBool01.end, true),
      {
        title: 'Hiển thị trang chủ',
        text: 'Chọn 0 hoặc 1.',
      },
    );
    const listsLastRow = Math.max(
      listLoc.end,
      listBenefit.end,
      listCat.end,
      listRole.end,
      listBool01.end,
      listJobStatus.end,
      listBlogStatus.end,
      listBlogCategory.end,
      listUserGender.end,
      listPostType.end,
      listJobNote.end,
    );

    setAutoColumnWidths(
      note,
      1,
      1,
      1,
      note.rowCount,
      12,
      32,
    );
    setAutoColumnWidths(
      note,
      2,
      2,
      1,
      note.rowCount,
      20,
      100,
    );
    setAutoColumnWidths(
      lists,
      1,
      18,
      1,
      listsLastRow,
      10,
      50,
    );
    applyPkFormulaColumn(c, COMPANIES_TPL_COL_COUNT, 2, TPL_DATA_ROW_END);
    applyPkFormulaColumn(u, USERS_TPL_COL_COUNT, 2, TPL_DATA_ROW_END);
    applyPkFormulaColumn(j, JOBS_TPL_COL_COUNT, 2, TPL_DATA_ROW_END);
    applyPkFormulaColumn(ja, JOB_APPS_TPL_COL_COUNT, 2, TPL_DATA_ROW_END);
    applyPkFormulaColumn(b, BLOGS_TPL_COL_COUNT, 2, TPL_DATA_ROW_END);

    // Đặt toàn bộ cột là Text để tránh Excel tự bỏ số 0 ở đầu.
    setAllColumnsText(c, COMPANIES_TPL_COL_COUNT);
    setAllColumnsText(u, USERS_TPL_COL_COUNT);
    setAllColumnsText(j, JOBS_TPL_COL_COUNT);
    setAllColumnsText(ja, JOB_APPS_TPL_COL_COUNT);
    setAllColumnsText(b, BLOGS_TPL_COL_COUNT);

    setAutoColumnWidths(c, 1, COMPANIES_TPL_COL_COUNT, 1, 2, 8, 50);
    setAutoColumnWidths(u, 1, USERS_TPL_COL_COUNT, 1, 2, 8, 48);
    setAutoColumnWidths(j, 1, JOBS_TPL_COL_COUNT, 1, 2, 9, 58);
    setAutoColumnWidths(ja, 1, JOB_APPS_TPL_COL_COUNT, 1, 2, 9, 55);
    setAutoColumnWidths(b, 1, BLOGS_TPL_COL_COUNT, 1, 2, 8, 55);

    setWrapTextForColumns(j, [2, 3, 4, 5, 6, 11, 12, 13, 14, 15, 16, 19, 20], 1, TPL_DATA_ROW_END);
    setWrapTextForColumns(c, [2, 5, 6, 7], 1, TPL_DATA_ROW_END);
    setWrapTextForColumns(ja, [7], 1, TPL_DATA_ROW_END);
    setWrapTextForColumns(b, [2, 3, 4], 1, TPL_DATA_ROW_END);

    styleDataSheet(c, COMPANIES_TPL_COL_COUNT, { freezeSplit: { xSplit: 2, ySplit: 1, topLeftCell: 'C2' } });
    styleDataSheet(u, USERS_TPL_COL_COUNT, { freezeSplit: { xSplit: 2, ySplit: 1, topLeftCell: 'C2' } });
    styleDataSheet(j, JOBS_TPL_COL_COUNT, { freezeSplit: { xSplit: 2, ySplit: 1, topLeftCell: 'C2' } });
    styleDataSheet(ja, JOB_APPS_TPL_COL_COUNT, { freezeSplit: { xSplit: 2, ySplit: 1, topLeftCell: 'C2' } });
    styleDataSheet(b, BLOGS_TPL_COL_COUNT, { freezeSplit: { xSplit: 0, ySplit: 1, topLeftCell: 'A2' } });

    ;[note, c, u, j, ja, b].forEach((ws) => {
      ws.getRow(1).font = { bold: true };
    });

    const raw = await wb.xlsx.writeBuffer();
    const xlsxBuffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    if (vbaraw && vbaraw.length > 0) {
      try {
        const withVba = attachVbaToXlsm(xlsxBuffer, vbaraw);
        return {
          buffer: withVba,
          fileName: 'mau-import-tuyengiaovien.xlsm',
          contentType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
          hasMacro: true,
        };
      } catch (e) {
        this.log.warn(
          `Gắn VBA thất bại, trả về .xlsx: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    return {
      buffer: xlsxBuffer,
      fileName: 'mau-import-tuyengiaovien.xlsx',
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      hasMacro: false,
    };
  }

  /**
   * Validate file Excel trước khi import.
   * Nếu có lỗi → KHÔNG xóa data cũ, KHÔNG insert gì.
   *
   * Quy ước:
   * - Optional fields: các field mô tả/URL/fileName có thể trống.
   * - Required theo sheet:
   *   - companies: name, mst
   *   - users: email, username, password
   *   - jobs: title, detail_description, company_id, user_id
   *   - job_applications: job_id, user_id (resume_path/cover_letter_* optional)
   *   - blogs: title, content (hoặc description), url, status (còn lại optional)
   */
  private async validateExcelBeforeImport(wb: ExcelJS.Workbook): Promise<string[]> {
    const errors: string[] = [];
    const excelUserLookups = buildExcelUserLookups(wb);

    const sheetNames = ['companies', 'users', 'jobs', 'job_applications', 'blogs'] as const;

    // Collect unique keys from file để validate trùng NGAY TRONG FILE (không so với DB).
    const fileCompanyMsts = new Set<string>();
    const fileUserEmails = new Set<string>();
    const fileUsernames = new Set<string>();

    for (const name of sheetNames) {
      const ws = wb.getWorksheet(name) ?? wb.getWorksheet(name.toUpperCase());
      if (!ws) continue;
      const h = buildHeaderMap(ws, 1);
      if (h.size === 0) continue;

      if (name === 'companies' && h.has('email')) {
        errors.push(
          'sheet "companies": cột "email" đã bỏ — xóa cột này khỏi file (email NTD điền ở sheet users, cột email).',
        );
      }
      if (name === 'jobs' && (h.has('user_email') || h.has('job_email'))) {
        errors.push(
          'sheet "jobs": cột "user_email" / "job_email" đã bỏ — dùng user_id (dropdown users) và email (liên hệ tin, trùng jobs.email trong DB).',
        );
      }

      for (let r = 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        if (!rowHasImportableData(name, row, h)) continue;
        const ctx = `sheet "${name}" dòng ${r}`;

        if (name === 'companies') {
          const companyName = str(getCell(row, h, 'name'));
          const mst = str(getCell(row, h, 'mst'));
          if (!companyName) errors.push(`${ctx}: thiếu name`);
          if (!mst) errors.push(`${ctx}: thiếu mst`);
          if (mst) {
            fileCompanyMsts.add(mst);
          }
          continue;
        }

        if (name === 'users') {
          const email = str(getCell(row, h, 'email'));
          const username = str(getCell(row, h, 'username'));
          const password = str(getCell(row, h, 'password'));
          if (!email) errors.push(`${ctx}: thiếu email`);
          if (!username) errors.push(`${ctx}: thiếu username`);
          if (!password) errors.push(`${ctx}: thiếu password`);
          if (email) {
            fileUserEmails.add(email);
          }
          if (username) {
            fileUsernames.add(username);
          }
          continue;
        }

        if (name === 'jobs') {
          const title = str(getCell(row, h, 'title'));
          const detailDescription =
            str(getCell(row, h, 'detail_description')) ||
            str(getCell(row, h, 'description'));
          const excelCompanyId = getResolvedNum(row, h, 'company_id');
          const excelUserId = getResolvedNum(row, h, 'user_id');
          if (!title) errors.push(`${ctx}: thiếu title`);
          if (!detailDescription) errors.push(`${ctx}: thiếu detail_description`);
          if (excelCompanyId == null) errors.push(`${ctx}: thiếu company_id`);
          if (excelUserId == null) errors.push(`${ctx}: thiếu user_id`);

          if (excelUserId != null) {
            const userRole = await this.resolveUserRoleForJobImport(
              excelUserId,
              excelUserLookups,
            );
            if (userRole === RoleStatus.USER) {
              errors.push(this.formatJobCandidateUserError(ctx, h, r, excelUserId));
            }
          }

          let salaryMin = num(getCell(row, h, 'salary_min'), 0);
          let salaryMax = num(getCell(row, h, 'salary_max'), 0);
          if (salaryMax > 0 && salaryMax < salaryMin) {
            // Tự động sửa lỗi gõ thiếu số 0 (vd: 100k < 10tr)
            if (salaryMax * 100 >= salaryMin) {
              salaryMax = salaryMax * 100;
            } else {
              salaryMax = salaryMin;
            }
          }
          if (salaryMax < salaryMin) errors.push(`${ctx}: salary_max phải >= salary_min`);
          continue;
        }

        // Bỏ qua validate sheet job_applications — không import sheet này
        if (name === 'job_applications') continue;

        if (name === 'blogs') {
          const title = str(getCell(row, h, 'title'));
          const content = str(getCell(row, h, 'content'));
          const desc = str(getCell(row, h, 'description'));
          const url = str(getCell(row, h, 'url'));
          const status = str(getCell(row, h, 'status'));
          if (!title) errors.push(`${ctx}: thiếu title`);
          // Cho phép dùng description thay content nếu muốn (optional rule)
          if (!content && !desc) errors.push(`${ctx}: thiếu content hoặc description`);
          if (!url) errors.push(`${ctx}: thiếu url`);
          if (!status) errors.push(`${ctx}: thiếu status`);
          continue;
        }
      }
    }

    // Bỏ qua validate VietQR ở bulk import vì VietQR rate limit 2 req/s làm fail toàn bộ file import lớn
    // if (fileCompanyMsts.size > 0) {
    //   const msts = Array.from(fileCompanyMsts);
    //   const invalid = await this.validateMstsWithVietQr(msts);
    //   invalid.forEach((mst) => errors.push(`companies: mst không tồn tại trên VietQR: ${mst}`));
    // }

    return errors;
  }

  /** Check MST trên VietQR; trả về danh sách MST không tồn tại/không hợp lệ. */
  private async validateMstsWithVietQr(msts: string[]): Promise<string[]> {
    const invalid: string[] = [];

    for (const mst of msts) {
      const t = String(mst || '').trim();
      if (!t || !isValidMstFormat(t)) {
        invalid.push(mst);
        continue;
      }

      const digits = normalizeMstDigits(t);
      const ok = await this.checkVietQrBusinessExists(digits).catch(() => false);
      if (!ok) invalid.push(t);
    }

    return invalid;
  }

  /**
   * VietQR business lookup.
   * API thường trả JSON có `code` = '00' khi thành công. Nếu response lỗi hoặc code != '00' → coi như không tồn tại.
   */
  private async checkVietQrBusinessExists(mst: string): Promise<boolean> {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(`https://api.vietqr.io/v2/business/${encodeURIComponent(mst)}`, {
        method: 'GET',
        signal: ctrl.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return false;
      const json = (await res.json()) as any;
      const code = String(json?.code ?? '').trim();
      if (code === '00') return true;
      // Một số trường hợp API dùng `data` rỗng để báo không tồn tại
      if (json?.data && typeof json.data === 'object') return true;
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async importFromExcelBuffer(
    fileBuffer: Buffer,
    options?: { dataMode?: AdminImportDataMode },
  ): Promise<AdminImportResultDto> {
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException('File rỗng');
    }
    const summary = {
      companies: 0,
      users: 0,
      jobs: 0,
      jobApplications: 0,
      blogs: 0,
    };
    const errors: string[] = [];
    const mstToCompanyId = new Map<string, number>();
    const emailToUserId = new Map<string, number>();
    /** Email user từ sheet users trong file import hiện tại (ưu tiên khi gán job theo email). */
    const excelEmailToUserId = new Map<string, number>();
    const jobKeyToId = new Map<string, number>();
    /** Id tạm trong file (cột A / công thức) → id thật DB sau import hoặc khi đã tồn tại. */
    const provCompanyIdToDbId = new Map<number, number>();
    const provUserIdToDbId = new Map<number, number>();
    const provJobIdToDbId = new Map<number, number>();

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(fileBuffer as unknown as never);

    const keepExistingData = options?.dataMode !== 'clear';

    // Validate trước, nếu có lỗi: không xóa data cũ, không import.
    const validateErrors = await this.validateExcelBeforeImport(wb);
    if (validateErrors.length > 0) {
      return {
        summary,
        errors: validateErrors,
      };
    }

    if (keepExistingData) {
      await this.seedExistingImportLookups(mstToCompanyId, emailToUserId);
      this.log.log('Import Excel: giữ nguyên dữ liệu cũ — chỉ thêm mới / bỏ qua bản ghi trùng.');
    } else {
      await this.clearAllDataBeforeExcelImport();
    }

    for (const name of [
      'companies',
      'users',
      'jobs',
      'job_applications',
      'blogs',
    ] as const) {
      const ws = wb.getWorksheet(name) ?? wb.getWorksheet(name.toUpperCase());
      if (!ws) continue;
      const h = buildHeaderMap(ws, 1);
      if (h.size === 0) continue;
      const allocProvId = createProvIdAllocator();
      for (let r = 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        if (!rowHasImportableData(name, row, h)) continue;
        const ctx = `sheet "${name}" dòng ${r}`;

        try {
          if (name === 'companies') {
            const companyName = str(getCell(row, h, 'name'));
            const mst = str(getCell(row, h, 'mst'));
            if (!companyName) {
              const cell = getCellByField(h, r, 'name');
              errors.push(`${ctx}${cell ? `: cell ${cell}` : ''}: thiếu name`);
              continue;
            }
            if (!mst) {
              const cell = getCellByField(h, r, 'mst');
              errors.push(`${ctx}${cell ? `: cell ${cell}` : ''}: thiếu mst`);
              continue;
            }
            const exist = await this.companyRepository.findOne({ where: { name: companyName, mst } });
            if (exist) {
              mstToCompanyId.set(mst, exist.id);
              provCompanyIdToDbId.set(allocProvId(row, h), exist.id);
              continue;
            }
            const orgRaw = str(getCell(row, h, 'organization_type'));
            let organizationType: number | null = null;
            if (orgRaw) {
              try {
                organizationType =
                  resolveSingleCode(orgRaw, ORGANIZATION_TYPE, 'organization_type', 0) || null;
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                const field = parseResolverFieldFromMessage(msg);
                const cell = field ? getCellByField(h, r, field) : null;
                errors.push(`${ctx}${cell ? `: cell ${cell}` : ''}: ${msg}`);
                continue;
              }
            }
            const ent = this.companyRepository.create({
              name: companyName,
              mst,
              website: str(getCell(row, h, 'website')) || null,
              address: str(getCell(row, h, 'address')) || null,
              taxAddress: str(getCell(row, h, 'tax_address')) || null,
              organizationType,
              companySize: num(getCell(row, h, 'company_size'), 0) || null,
              foundedYear: num(getCell(row, h, 'founded_year'), 0) || null,
              isWaiting: toBool01(getCell(row, h, 'is_waiting'), false),
              isFeatured: toBool01(getCell(row, h, 'is_featured'), false),
              logo: str(getCell(row, h, 'logo')) || null,
              insight: str(getCell(row, h, 'insight')) || null,
              overview: str(getCell(row, h, 'overview')) || null,
              description: str(getCell(row, h, 'description')) || null,
              facebookLink: str(getCell(row, h, 'facebook_link')) || null,
              twitterLink: str(getCell(row, h, 'twitter_link')) || null,
              linkedInLink: str(getCell(row, h, 'linkedin_link')) || null,
              instagramLink: str(getCell(row, h, 'instagram_link')) || null,
              videoUrl: str(getCell(row, h, 'video_url')) || null,
              bannerImage: str(getCell(row, h, 'banner_image')) || null,
            } as Company);
            const saved = await this.companyRepository.save(ent);
            mstToCompanyId.set(mst, saved.id);
            provCompanyIdToDbId.set(allocProvId(row, h), saved.id);
            summary.companies += 1;
            continue;
          }

          if (name === 'users') {
            const email = str(getCell(row, h, 'email'));
            const username = str(getCell(row, h, 'username'));
            const password = str(getCell(row, h, 'password'));
            if (!email || !username || !password) {
              const cell = getCellByField(h, r, 'email') ?? getCellByField(h, r, 'username') ?? getCellByField(h, r, 'password');
              errors.push(`${ctx}${cell ? `: cell ${cell}` : ''}: cần email, username, password`);
              continue;
            }
            const [dupE, dupU] = await Promise.all([
              this.userRepository.findOne({ where: { email } }),
              this.userRepository.findOne({ where: { username } }),
            ]);
            if (dupE || dupU) {
              const prev = dupE ?? dupU;
              if (prev) {
                if (dupE) emailToUserId.set(dupE.email, dupE.id);
                excelEmailToUserId.set(normalizeImportEmail(email), prev.id);
                provUserIdToDbId.set(allocProvId(row, h), prev.id);
              }
              continue;
            }
            const companyMst = str(getCell(row, h, 'company_mst'));
            const excelCompanyId = getResolvedNum(row, h, 'company_id');
            let companyId: number | null = null;
            if (excelCompanyId != null) {
              companyId = await resolveImportFkId(
                excelCompanyId,
                provCompanyIdToDbId,
                keepExistingData,
                () => this.companyRepository.findOne({ where: { id: excelCompanyId } }),
              );
            }
            if (companyId == null && companyMst) {
              const cid = mstToCompanyId.get(companyMst);
              if (cid) companyId = cid;
              else {
                const c = await this.companyRepository.findOne({ where: { mst: companyMst } });
                if (c) {
                  companyId = c.id;
                  mstToCompanyId.set(companyMst, c.id);
                }
              }
            }
            const roleCode = resolveRoleUser(str(getCell(row, h, 'role')), RoleStatus.USER);
            const role = resolveImportUserRoleFromCode(roleCode);

            // users.location/expertise lưu dạng mã số (string). Excel có thể nhập mã hoặc chọn nhãn từ list.
            let location: string | null = null;
            const locRaw = str(getCell(row, h, 'location'));
            if (locRaw) {
              try {
                const locCode = resolveSingleCode(locRaw, LOCATION, 'location', 0);
                location = locCode ? String(locCode) : null;
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                const field = parseResolverFieldFromMessage(msg);
                const cell = field ? getCellByField(h, r, field) : null;
                errors.push(`${ctx}${cell ? `: cell ${cell}` : ''}: ${msg}`);
                continue;
              }
            }

            let expertise: string | null = null;
            const expRaw = str(getCell(row, h, 'expertise'));
            if (expRaw) {
              try {
                expertise = resolveCommaCodes(expRaw, CATEGORY, 'expertise') || null;
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                const field = parseResolverFieldFromMessage(msg);
                const cell = field ? getCellByField(h, r, field) : null;
                errors.push(`${ctx}${cell ? `: cell ${cell}` : ''}: ${msg}`);
                continue;
              }
            }
            const hashed = await bcrypt.hash(password, 10);
            const ent = this.userRepository.create({
              email,
              username,
              password: hashed,
              fullName: str(getCell(row, h, 'full_name')) || username,
              phoneNumber: str(getCell(row, h, 'phone_number')) || null,
              location,
              expertise,
              gender: str(getCell(row, h, 'gender')) || null,
              cvUrl: str(getCell(row, h, 'cv_url')) || null,
              cvFileName: str(getCell(row, h, 'cv_file_name')) || null,
              coverLetterUrl: str(getCell(row, h, 'cover_letter_url')) || null,
              coverLetterFileName: str(getCell(row, h, 'cover_letter_file_name')) || null,
              coverLetterText: str(getCell(row, h, 'cover_letter_text')) || null,
              role,
              companyId: companyId ?? null,
              isHostCompany: toBool01(getCell(row, h, 'is_host_company'), false),
              isActive: toBool01(getCell(row, h, 'is_active'), true),
              avatarUrl: str(getCell(row, h, 'avatar_url')) || null,
              avatarFileName: str(getCell(row, h, 'avatar_file_name')) || null,
            } as User);
            const saved = await this.userRepository.save(ent);
            emailToUserId.set(email, saved.id);
            emailToUserId.set(normalizeImportEmail(email), saved.id);
            excelEmailToUserId.set(normalizeImportEmail(email), saved.id);
            provUserIdToDbId.set(allocProvId(row, h), saved.id);
            summary.users += 1;
            continue;
          }

          if (name === 'jobs') {
            const title = str(getCell(row, h, 'title'));
            const detailDescription =
              str(getCell(row, h, 'detail_description')) ||
              str(getCell(row, h, 'description'));
            const excelJobCompanyId = getResolvedNum(row, h, 'company_id');
            const excelJobUserId = getResolvedNum(row, h, 'user_id');
            if (
              !title ||
              !detailDescription ||
              excelJobCompanyId == null ||
              excelJobUserId == null
            ) {
              const cell = getCellByField(h, r, 'title');
              errors.push(
                `${ctx}${cell ? `: cell ${cell}` : ''}: cần title, detail_description, company_id, user_id`,
              );
              continue;
            }
            let salaryMin = num(getCell(row, h, 'salary_min'), 0);
            let salaryMax = num(getCell(row, h, 'salary_max'), 0);
            const address = str(getCell(row, h, 'address')) || 'Việt Nam';
            if (salaryMax > 0 && salaryMax < salaryMin) {
              if (salaryMax * 100 >= salaryMin) {
                salaryMax = salaryMax * 100;
              } else {
                salaryMax = salaryMin;
              }
            }
            if (salaryMax < salaryMin) {
              const cellMax = getCellByField(h, r, 'salary_max');
              const cellMin = getCellByField(h, r, 'salary_min');
              errors.push(`${ctx}${cellMax || cellMin ? `: cell ${cellMax ?? cellMin}` : ''}: salary_max phải >= salary_min`);
              continue;
            }
            let companyId = 0;
            const resolvedCompanyId = await resolveImportFkId(
              excelJobCompanyId!,
              provCompanyIdToDbId,
              keepExistingData,
              () => this.companyRepository.findOne({ where: { id: excelJobCompanyId! } }),
            );
            if (resolvedCompanyId) companyId = resolvedCompanyId;
            if (!companyId) {
              const cell = getCellByField(h, r, 'company_id');
              errors.push(`${ctx}${cell ? `: cell ${cell}` : ''}: không tìm thấy company (company_id)`);
              continue;
            }
            let userId = 0;
            const jobContactEmail = str(getCell(row, h, 'email'));
            const resolvedUserId = await this.resolveJobImportUserId(
              excelJobUserId,
              jobContactEmail,
              provUserIdToDbId,
              excelEmailToUserId,
              emailToUserId,
              keepExistingData,
            );
            if (resolvedUserId) userId = resolvedUserId;
            if (!userId) {
              errors.push(
                formatJobUserNotFoundError(
                  ctx,
                  h,
                  r,
                  excelJobUserId,
                  jobContactEmail,
                  excelEmailToUserId,
                ),
              );
              continue;
            }

            const jobOwner = await this.userRepository.findOne({
              where: { id: userId },
              select: ['id', 'role'],
            });
            if (!jobOwner || jobOwner.role === RoleStatus.USER) {
              errors.push(
                this.formatJobCandidateUserError(ctx, h, r, excelJobUserId!),
              );
              continue;
            }

            const rawStatus = str(getCell(row, h, 'status'));
            const rawTrim = rawStatus.trim();
            let st = isSelectHintValue(rawTrim) ? 'APPROVED' : rawTrim.toUpperCase();
            if (st === 'PENDING') st = 'ADMIN_REVIEW';
            const allowedJobsStatus = ['APPROVED', 'ADMIN_REVIEW', 'REJECTED'];
            if (!allowedJobsStatus.includes(st)) {
              const cell = getCellByField(h, r, 'status');
              errors.push(`${ctx}${cell ? `: cell ${cell}` : ''}: status: giá trị không hợp lệ "${rawStatus}"`);
              continue;
            }
            const status = st;
            let category: string;
            let location: string;
            let typeOfEmployment: number;
            let salaryType: number;
            let experienceLevel: number | null;
            let requiredQualification: string | null;
            let grade: number | null;
            let gender: string;
            let benefits: string;
            try {
              category = mergeListFields(
                row,
                h,
                JOB_CATEGORY_KEYS,
                CATEGORY,
                'category',
                '1',
              );
              location = mergeListFields(
                row,
                h,
                JOB_LOCATION_KEYS,
                LOCATION,
                'location',
                '1',
              );
              const toeRaw = str(getCell(row, h, 'type_of_employment')) || '1';
              typeOfEmployment =
                resolveSingleCode(
                  toeRaw,
                  TYPE_OF_EMPLOYMENT,
                  'type_of_employment',
                  0,
                ) || 1;
              const salTypeRaw = str(getCell(row, h, 'salary_type')) || '1';
              salaryType =
                resolveSingleCode(salTypeRaw, SALARY_TYPE, 'salary_type', 0) || 1;
              const expS = str(getCell(row, h, 'experience_level'));
              experienceLevel = resolveOptionalInt(expS, EXPERIENCE_LEVEL, 'experience_level');
              const qualRaw = str(getCell(row, h, 'required_qualification'));
              requiredQualification = resolveCommaCodes(
                qualRaw,
                REQUIRED_QUALIFICATION,
                'required_qualification',
              );
              const gradeS = str(getCell(row, h, 'grade'));
              grade = resolveOptionalInt(gradeS, GRADE, 'grade');
              const genRaw = str(getCell(row, h, 'gender')) || '1';
              gender = resolveCommaCodes(genRaw, GENDER_JOB, 'gender') || '1';
              benefits = mergeListFields(
                row,
                h,
                JOB_BENEFIT_KEYS,
                JOB_BENEFITS,
                'benefits',
                '1',
              );
              if (!benefits) {
                benefits = '1';
              }
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              const field = parseResolverFieldFromMessage(msg);
              const cell = field ? getCellByField(h, r, field) : null;
              errors.push(`${ctx}${cell ? `: cell ${cell}` : ''}: ${msg}`);
              continue;
            }
            const ent = this.jobRepository.create({
              title,
              detailDescription,
              category,
              location,
              typeOfEmployment,
              experienceLevel,
              requiredQualification,
              gender,
              grade,
              userId,
              companyId,
              status,
              imageLogo: str(getCell(row, h, 'image_logo')) || null,
              bannerLogo: str(getCell(row, h, 'banner_logo')) || null,
              postedDate: parseDateVal(getCell(row, h, 'posted_date')),
              deadline: parseDateVal(getCell(row, h, 'deadline')),
              salaryMin,
              salaryMax,
              salaryType,
              email: str(getCell(row, h, 'email')) || null,
              phoneNumber: str(getCell(row, h, 'phone_number')) || null,
              benefits,
              address,
              postType: (() => {
                const raw = str(getCell(row, h, 'post_type'));
                return isSelectHintValue(raw) ? 'Basic' : raw || 'Basic';
              })(),
              note: (() => {
                const raw = str(getCell(row, h, 'note'));
                return isSelectHintValue(raw) ? 'user' : raw || 'user';
              })(),
            } as Job);
            const saved = await this.jobRepository.save(ent);
            jobKeyToId.set(`#${companyId}::${title}`, saved.id);
            provJobIdToDbId.set(allocProvId(row, h), saved.id);
            summary.jobs += 1;
            continue;
          }

          if (name === 'job_applications') {
            // Bỏ qua không import sheet job_applications
            continue;
          }

          if (name === 'blogs') {
            const title = str(getCell(row, h, 'title'));
            if (!title) {
              const cell = getCellByField(h, r, 'title');
              errors.push(`${ctx}${cell ? `: cell ${cell}` : ''}: thiếu title`);
              continue;
            }
            const urlIn = str(getCell(row, h, 'url'));
            const slug = slugifyTitle(title) || 'blog';
            const url = urlIn ? urlIn : `${slug}-import-${r}-${Date.now()}`;

            const rawStatus = str(getCell(row, h, 'status'));
            const rawTrim = rawStatus.trim();
            const st =
              !rawTrim || rawTrim === SELECT_MULTI_LABEL || rawTrim === SELECT_SINGLE_LABEL
                ? 'published'
                : rawTrim.toLowerCase();
            const allowedBlogsStatus = ['published', 'draft'];
            if (rawTrim && !allowedBlogsStatus.includes(st)) {
              const cell = getCellByField(h, r, 'status');
              errors.push(`${ctx}${cell ? `: cell ${cell}` : ''}: status: giá trị không hợp lệ "${rawStatus}" (chỉ published/draft)`);
              continue;
            }
            const ent = this.blogRepository.create({
              title,
              content: str(getCell(row, h, 'content')) || '',
              description: str(getCell(row, h, 'description')) || null,
              image: str(getCell(row, h, 'image')) || 'https://placehold.co/800x400',
              url,
              author: str(getCell(row, h, 'author')) || 'Admin',
              status: st,
              titleSeo: str(getCell(row, h, 'title_seo')) || null,
              metaDescription: str(getCell(row, h, 'meta_description')) || null,
              category: str(getCell(row, h, 'category')) || null,
              displayOnHomepage: toBool01(getCell(row, h, 'display_on_homepage'), false),
            } as Blog);
            await this.blogRepository.save(ent);
            summary.blogs += 1;
            continue;
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const field = parseResolverFieldFromMessage(msg);
          const cell = field ? getCellByField(h, r, field) : null;
          errors.push(`${ctx}${cell ? `: cell ${cell}` : ''}: ${msg}`);
        }
      }
    }

    return { summary, errors };
  }
}
