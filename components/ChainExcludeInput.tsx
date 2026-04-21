"use client";

import KeywordInput from "./KeywordInput";

interface Props {
  values: string[];
  onChange: (next: string[]) => void;
}

export default function ChainExcludeInput({ values, onChange }: Props) {
  return (
    <KeywordInput
      label="Chain names to exclude"
      values={values}
      onChange={onChange}
      placeholder="Type a chain name and press Enter"
      ariaLabel="Chain names to exclude"
    />
  );
}
