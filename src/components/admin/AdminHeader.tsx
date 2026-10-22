import { PendingButton } from './PendingButton';
import styles from './AdminHeader.module.css';

export type AdminIdentityView = {
  /** "Sesión iniciada como", already translated. */
  signedInAs: string;
  /** The signed-in email, display only; null shows `fallback` alone. */
  email: string | null;
  /** "Sesión de administrador", shown when there is no email. */
  fallback: string;
};

export type AdminSignOut = {
  /** The sign-out server action, passed down by the layout: this component imports nothing from src/server. */
  action: () => void | Promise<void>;
  label: string;
  pendingLabel: string;
};

export type AdminHeaderProps = {
  siteName: string;
  /** "Administración", the visible label next to the brand. */
  areaLabel: string;
  /** With both, the identity and the sign-out button show; without, the header is brand only. */
  identity?: AdminIdentityView;
  signOut?: AdminSignOut;
};

/**
 * The admin header: a dark top rule, the site name as plain text (not a link),
 * the area label, and, for a signed-in admin, whose session it is and a
 * sign-out button in a form (never a link, so it cannot be fired cross-site).
 */
export function AdminHeader({ siteName, areaLabel, identity, signOut }: AdminHeaderProps) {
  return (
    <header className={styles.header} data-testid="admin-header">
      <div className={styles.inner}>
        <div className={styles.brand}>
          <span className={styles.name}>{siteName}</span>
          <span className={styles.divider} aria-hidden="true" />
          <span className={styles.area}>{areaLabel}</span>
        </div>
        {identity && signOut ? (
          <div className={styles.session}>
            <div className={styles.identity} data-testid="admin-identity">
              {identity.email === null ? (
                <span className={styles.fallback}>{identity.fallback}</span>
              ) : (
                <>
                  <span className={styles.signedInAs}>{identity.signedInAs}</span>
                  <span className={styles.email}>{identity.email}</span>
                </>
              )}
            </div>
            <form action={signOut.action}>
              <PendingButton
                variant="outlined"
                label={signOut.label}
                pendingLabel={signOut.pendingLabel}
                testId="admin-sign-out"
              />
            </form>
          </div>
        ) : null}
      </div>
    </header>
  );
}
