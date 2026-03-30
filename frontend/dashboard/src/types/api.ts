export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    perPage: number;
  };
}

export interface ApiResponse<T> {
  data: T;
}

export interface ApiError {
  statusCode: number;
  message: string | string[];
  error: string;
}
