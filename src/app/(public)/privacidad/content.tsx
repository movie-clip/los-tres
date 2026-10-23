import type { OwnerIdentity } from '@/config/owner';
import {
  LegalHeading,
  LegalItem,
  LegalList,
  LegalParagraph,
  LegalText,
  LegalTitle,
  legalRichTags,
  type LegalTranslator,
} from '@/components/LegalText';

export type PrivacyContentProps = {
  /** Translator for the Privacy namespace. */
  t: LegalTranslator;
  siteName: string;
  owner: OwnerIdentity;
};

/** The Política de privacidad text. Values are plain text; React escapes them. */
export function PrivacyContent({ t, siteName, owner }: PrivacyContentProps) {
  const tags = legalRichTags(owner.contactEmail);
  const contact = { contactEmail: owner.contactEmail, ...tags };
  return (
    <LegalText>
      <LegalTitle>{t('heading')}</LegalTitle>
      <LegalHeading>{t('controllerHeading')}</LegalHeading>
      <LegalParagraph>
        {t.rich('controllerBody', {
          ownerName: owner.name,
          ownerNif: owner.nif,
          ownerAddress: owner.address,
          ...contact,
        })}
      </LegalParagraph>
      <LegalHeading>{t('cookiesHeading')}</LegalHeading>
      <LegalParagraph>{t('cookiesBody', { siteName })}</LegalParagraph>
      <LegalHeading>{t('dataHeading')}</LegalHeading>
      <LegalList>
        <LegalItem>{t.rich('dataClicks', tags)}</LegalItem>
        <LegalItem>{t.rich('dataLogs', tags)}</LegalItem>
      </LegalList>
      <LegalParagraph>{t('dataBasis')}</LegalParagraph>
      <LegalHeading>{t('leavingHeading')}</LegalHeading>
      <LegalParagraph>{t('leavingBody', { siteName })}</LegalParagraph>
      <LegalHeading>{t('writingHeading')}</LegalHeading>
      <LegalParagraph>{t('writingBody')}</LegalParagraph>
      <LegalHeading>{t('adminsHeading')}</LegalHeading>
      <LegalParagraph>{t('adminsBody')}</LegalParagraph>
      <LegalHeading>{t('recipientsHeading')}</LegalHeading>
      <LegalParagraph>{t('recipientsBody')}</LegalParagraph>
      <LegalHeading>{t('rightsHeading')}</LegalHeading>
      <LegalParagraph>{t.rich('rightsBody', contact)}</LegalParagraph>
      <LegalHeading>{t('changesHeading')}</LegalHeading>
      <LegalParagraph>{t('changesBody')}</LegalParagraph>
    </LegalText>
  );
}
