import {
  deleteHousehold,
  getHouseholdDetail,
  leaveHousehold,
  regenerateInviteCode,
} from '@/lib/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export function useHouseholdDetail(id: string | null | undefined) {
  return useQuery({
    queryKey: ['household', id],
    queryFn: () => getHouseholdDetail(id as string),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useRegenerateInviteCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => regenerateInviteCode(id),
    onSuccess: (_code, { id }) => {
      qc.invalidateQueries({ queryKey: ['household', id] });
    },
  });
}

export function useLeaveHousehold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => leaveHousehold(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useDeleteHousehold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => deleteHousehold(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
