import { StatusTag } from './StatusTag';

export type CategoryStateTagProps = {
  /** The state the server stored for the category. */
  kind: 'not_reviewed' | 'mapped' | 'outside';
  /** "Sin revisar", "Asignada a Aceite de motor" or "Fuera del catálogo", already translated. */
  label: string;
  testId?: string;
};

/**
 * The state of a feed category as a tag. It borrows the three Status tag looks by
 * look, not by meaning: filled for not reviewed (the one that stands out),
 * outlined for assigned, dashed for outside the catalogue. The words carry the meaning.
 */
export function CategoryStateTag({ kind, label, testId }: CategoryStateTagProps) {
  const variant = kind === 'not_reviewed' ? 'approved' : kind === 'mapped' ? 'notApproved' : 'paused';
  return <StatusTag variant={variant} label={label} testId={testId} />;
}
