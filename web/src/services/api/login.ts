import request from '@/services/request';

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  code: number;
  message: string;
  data: {
    token: string;
    username: string;
  } | null;
  error?: {
    type?: string;
    detail?: string;
  };
}

export const authApi = {
  // 登录
  login: (params: LoginRequest): Promise<LoginResponse> => request.post('/api/login', params, {
      silent: true,
    } as any) as Promise<LoginResponse>,

  // 登出
  logout: () => request.post('/api/v1/logout'),
};
