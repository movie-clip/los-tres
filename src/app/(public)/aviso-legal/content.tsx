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

export type LegalNoticeContentProps = {
  /** Translator for the LegalNotice namespace. */
  t: LegalTranslator;
  siteName: string;
  owner: OwnerIdentity;
};

/** The Aviso legal text. Values are plain text; React escapes them. */
export function LegalNoticeContent({ t, siteName, owner }: LegalNoticeContentProps) {
  const values = { siteName };
  return (
    <LegalText>
      <LegalTitle>{t('heading')}</LegalTitle>
      <LegalParagraph>{t('intro')}</LegalParagraph>
      <LegalList>
        <LegalItem>{t('holder', { ownerName: owner.name })}</LegalItem>
        <LegalItem>{t('nif', { ownerNif: owner.nif })}</LegalItem>
        <LegalItem>{t('address', { ownerAddress: owner.address })}</LegalItem>
        <LegalItem>
          {t.rich('email', {
            contactEmail: owner.contactEmail,
            ...legalRichTags(owner.contactEmail),
          })}
        </LegalItem>
        {/* Absent, not empty, when the owner has no registry data. */}
        {owner.registry !== null && (
          <LegalItem>{t('registry', { ownerRegistry: owner.registry })}</LegalItem>
        )}
      </LegalList>
      <LegalHeading>{t('objectHeading')}</LegalHeading>
      <LegalParagraph>{t('objectBody', values)}</LegalParagraph>
      <LegalHeading>{t('pricesHeading')}</LegalHeading>
      <LegalParagraph>{t('pricesBody', values)}</LegalParagraph>
      <LegalHeading>{t('demoHeading')}</LegalHeading>
      <LegalParagraph>{t('demoBody')}</LegalParagraph>
      <LegalHeading>{t('ipHeading')}</LegalHeading>
      <LegalParagraph>{t('ipBody', values)}</LegalParagraph>
      <LegalHeading>{t('linksHeading')}</LegalHeading>
      <LegalParagraph>{t('linksBody', values)}</LegalParagraph>
      <LegalHeading>{t('lawHeading')}</LegalHeading>
      <LegalParagraph>{t('lawBody')}</LegalParagraph>
    </LegalText>
  );
}
