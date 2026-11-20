'use client';

import { useFormStatus } from 'react-dom';

import { SelectField, type SelectFieldProps } from './SelectField';

/** The Select field of a row: while the row's form saves it ignores the pointer and stays in the focus order. */
export function CategorySelect(props: Omit<SelectFieldProps, 'readOnly'>) {
  const { pending } = useFormStatus();
  return <SelectField {...props} readOnly={pending} />;
}
