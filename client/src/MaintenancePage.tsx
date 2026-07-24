/** Public screen when the site is closed for visitors (admin stays at /admin). */

type Props = {
  /** While status is unknown, avoid claiming maintenance. */
  pending?: boolean;
};

export function MaintenancePage({ pending = false }: Props) {
  return (
    <main className="maintenance-page">
      <div className="maintenance-inner">
        <h1 className="maintenance-brand">VOLVO EWD</h1>
        {!pending ? (
          <>
            <div
              className="maintenance-car"
              role="img"
              aria-label="Volvo V70 / XC70 / S80"
            />
            <p className="maintenance-msg">сайт на профилактических работах</p>
          </>
        ) : (
          <p className="maintenance-msg maintenance-msg--pending" aria-live="polite">
            …
          </p>
        )}
      </div>
    </main>
  );
}
