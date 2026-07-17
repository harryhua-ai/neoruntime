import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { deviceApi } from '@/services/api';

export const useNetworkConfig = () => useQuery({
    queryKey: ['network', 'config'],
    queryFn: async () => {
      const response = await deviceApi.getNetworkConfig();
      return response.data;
    },
  });

export const useUpdateNetworkConfig = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (config: any) => {
      const response = await deviceApi.updateNetworkConfig(config);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['network', 'config'] });
    },
  });
};

export const useStorageInfo = () => useQuery({
    queryKey: ['storage', 'info'],
    queryFn: async () => {
      const response = await deviceApi.getStorageInfo();
      return response.data;
    },
    refetchInterval: 10000,
  });

export const useFormatStorage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (path: string) => {
      const response = await deviceApi.formatStorage(path);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage', 'info'] });
    },
  });
};
