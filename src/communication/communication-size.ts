import { customFieldValue } from '../clickup/clickup-task.js';
import type { ClickUpTask } from '../clickup/clickup.types.js';

export const COMMUNICATION_SIZES = ['P', 'M', 'G'] as const;
export type CommunicationSize = (typeof COMMUNICATION_SIZES)[number];

const SIZE_FIELD_ID = '819f5dba-a281-4751-bee2-d7a806c0da7c';
const SIZE_FIELD_NAME = 'Comunicação Cliente';

export function communicationSize(task: ClickUpTask): CommunicationSize | null {
  const value = customFieldValue(task, SIZE_FIELD_ID, SIZE_FIELD_NAME);
  return COMMUNICATION_SIZES.find((size) => size === value) ?? null;
}
