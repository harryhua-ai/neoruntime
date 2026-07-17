import request from '@/services/request';

// Events API
export const eventsApi = {
  // 获取主题列表
  listTopics: () => request.get('/api/v1/events/topics'),

  // 发布事件
  publish: (topic: string, payload?: Record<string, unknown>) => request.post('/api/v1/events/publish', { topic, payload }),

  // 订阅主题
  subscribe: (topic: string) => request.post('/api/v1/events/subscribe', { topic }),

  // 取消订阅主题
  unsubscribe: (topic: string) => request.post('/api/v1/events/unsubscribe', { topic }),

  // WebSocket 事件流地址
  getStreamUrl: (topics?: string[]) => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const base = `${proto}//${window.location.host}/api/v1/events/stream`;
    if (!topics?.length) return base;
    const params = new URLSearchParams();
    topics.forEach(t => params.append('topic', t));
    return `${base}?${params.toString()}`;
  },
};
