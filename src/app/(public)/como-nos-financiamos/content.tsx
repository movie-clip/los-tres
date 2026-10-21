import {
  LegalItem,
  LegalList,
  LegalParagraph,
  LegalText,
  LegalTitle,
  legalRichTags,
  type LegalTranslator,
} from '@/components/LegalText';

export type FundingContentProps = {
  /** Translator for the Funding namespace. */
  t: LegalTranslator;
  siteName: string;
};

/** The affiliate disclosure. It needs no owner identity. */
export function FundingContent({ t, siteName }: FundingContentProps) {
  const tags = legalRichTags();
  return (
    <LegalText>
      <LegalTitle>{t('heading', { siteName })}</LegalTitle>
      <LegalParagraph>{t('intro', { siteName })}</LegalParagraph>
      <LegalList>
        <LegalItem>{t.rich('noExtraCost', tags)}</LegalItem>
        <LegalItem>{t.rich('noSales', tags)}</LegalItem>
        <LegalItem>{t.rich('noPaidRanking', tags)}</LegalItem>
      </LegalList>
    </LegalText>
  );
}
