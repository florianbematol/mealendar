import { fetchMe } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';

export function useMe(enabled = true) {
  return useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
    enabled,
    staleTime: 60_000,
  });
}
