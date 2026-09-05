export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = 'HB_INVALID_INPUT') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export class NotFoundError extends ApiError {
  constructor(message = '找不到此批次，或你沒有存取權限。') {
    super(message, 404, 'HB_NOT_FOUND');
  }
}

export class ConflictError extends ApiError {
  constructor(message = '批次已更新，請重新載入並審查後再核准。') {
    super(message, 409, 'HB_CONFLICT');
  }
}
