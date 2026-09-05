import { getDatabase } from './db';
import { createAssuranceRepository } from './assurance-repository';
export const assuranceStore = (ownerId: string) =>
  createAssuranceRepository(getDatabase(), ownerId);
