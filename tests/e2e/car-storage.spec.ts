import { expect, test, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { CAR, CAR_STORAGE_KEY, cocheValues, selectedText, storageOf } from '../support/car';

// US-5.7 ACs 31 to 34 and 37 against the Compose stack, journey J6 of 0006 rule 12: the choice on the device
// under the localStorage key "mi-coche" (D-21). Written by the picker only, restored on a page opened without
// coche, cleared by Quitar; opening a URL with coche never writes it (D-8). The storage logic itself is
// unit/car-storage.test.ts.

// #339 (0006 rule 12): journey J6, the stored car restored on a later visit, and removed. One browser context holds the whole story, so the storage the picker writes is the storage the later
// visit reads.
test.describe('stored car journey (#339)', () => {
  const ROOT_CATEGORY = '/categoria/mantenimiento-del-coche';
  const picker = (page: Page) => page.getByRole('dialog', { name: messages.CarPicker.title });
  const startingWith = (text: string): RegExp => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

  test('J6: a link with a car stores nothing, the picker stores the slug only, a later visit restores it with no history entry, and Quitar removes it', async ({
    page,
    context,
  }) => {
    // A shared link that carries a car shows it and writes nothing.
    await page.goto(`/?coche=${CAR.slug}`);
    await expect(page.getByRole('button', { name: messages.Car.changeLabel })).toBeVisible();
    expect(await storageOf(page)).toEqual({});

    // The picker writes the slug, and only the slug, under the one key.
    await page.goto(ROOT_CATEGORY);
    await page.getByRole('button', { name: messages.Car.select }).click();
    await picker(page).getByRole('button', { name: CAR.make, exact: true }).click();
    await picker(page).getByRole('button', { name: startingWith(`${CAR.model} ${CAR.generation}`) }).click();
    await picker(page).getByRole('button', { name: startingWith(CAR.engine) }).click();
    await expect(page.getByRole('group', { name: messages.Car.groupLabel })).toContainText(selectedText(CAR));
    expect(await storageOf(page)).toEqual({ [CAR_STORAGE_KEY]: CAR.slug });
    // Another key of the site's own is left alone by everything below.
    await page.evaluate(() => window.localStorage.setItem('otra-clave', 'valor'));

    // A later visit to a page opened without a car ends at the same address plus the car, keeping the query and
    // the fragment. The restore replaces the entry: the visit adds one history entry, not two.
    const entriesBefore = await page.evaluate(() => window.history.length);
    await page.goto('/buscar?q=filtro#resultados');
    await page.waitForURL((url) => url.searchParams.get('coche') === CAR.slug);
    const restored = new URL(page.url());
    expect(restored.pathname + restored.search + restored.hash).toBe(`/buscar?q=filtro&coche=${CAR.slug}#resultados`);
    await expect(page.getByRole('group', { name: messages.Car.groupLabel })).toContainText(selectedText(CAR));
    expect(await page.evaluate(() => window.history.length)).toBe(entriesBefore + 1);
    expect(await storageOf(page)).toEqual({ [CAR_STORAGE_KEY]: CAR.slug, 'otra-clave': 'valor' });

    // Quitar drops the car from the address (the query stays) and from storage (the other key stays).
    await page.getByRole('link', { name: messages.Car.removeLabel }).click();
    await page.waitForURL((url) => !url.searchParams.has('coche'));
    expect(new URL(page.url()).search).toBe('?q=filtro');
    await expect(page.getByRole('button', { name: messages.Car.select })).toBeVisible();
    expect(await storageOf(page)).toEqual({ 'otra-clave': 'valor' });

    // And it stays removed: after a reload has hydrated, no car is put back.
    await page.reload();
    await expect(page.getByRole('button', { name: messages.Car.select })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(cocheValues(page.url())).toEqual([]);
    expect(await context.cookies()).toEqual([]);
  });
});
