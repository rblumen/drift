// @vitest-environment jsdom
//
// Issue #151: native window.confirm() at the Reset and Remove-account call
// sites was replaced with this styled, accessible ConfirmDialog. These tests
// cover the a11y contract directly: role/labelling, initial focus, Escape,
// Tab trap, backdrop click, and focus restoration to the trigger.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

function Harness() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<'none' | 'confirmed' | 'cancelled'>('none');
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open trigger</button>
      <div data-testid="result">{result}</div>
      <ConfirmDialog
        open={open}
        title="Remove account?"
        message='Remove "Test" and all its positions?'
        confirmLabel="Remove"
        destructive
        onConfirm={() => { setResult('confirmed'); setOpen(false); }}
        onCancel={() => { setResult('cancelled'); setOpen(false); }}
      />
    </div>
  );
}

async function render(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<Harness />); });
}

function fire(el: Document, type: string, opts: KeyboardEventInit = {}): Promise<void> {
  return act(async () => {
    el.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...opts }));
  });
}

async function openDialog(): Promise<void> {
  const trigger = [...document.querySelectorAll('button')].find(b => b.textContent === 'Open trigger')!;
  // jsdom's .click() does not move focus the way a real browser click does,
  // so focus the trigger explicitly first — this is what lets the dialog
  // capture it as "the element to restore focus to on close".
  await act(async () => { trigger.focus(); trigger.click(); });
}

beforeEach(async () => {
  await render();
});

afterEach(async () => {
  if (root) { await act(async () => { root!.unmount(); }); root = null; }
  container?.remove();
});

describe('ConfirmDialog (issue #151)', () => {
  it('is not in the DOM when closed', () => {
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('renders with alertdialog role, aria-modal, and a labelled title on open', async () => {
    await openDialog();
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog!.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog!.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe('Remove account?');
  });

  it('moves initial focus to the Cancel button', async () => {
    await openDialog();
    expect(document.activeElement?.textContent).toBe('Cancel');
  });

  it('Escape cancels and restores focus to the trigger', async () => {
    await openDialog();
    await fire(document, 'keydown', { key: 'Escape' });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.querySelector('[data-testid="result"]')?.textContent).toBe('cancelled');
    expect(document.activeElement?.tagName).toBe('BUTTON');
    expect((document.activeElement as HTMLButtonElement)?.textContent).toBe('Open trigger');
  });

  it('backdrop click cancels', async () => {
    await openDialog();
    const backdrop = document.querySelectorAll('.fixed.inset-0')[0] as HTMLElement;
    await act(async () => { backdrop.click(); });
    expect(document.querySelector('[data-testid="result"]')?.textContent).toBe('cancelled');
  });

  it('clicking Remove confirms', async () => {
    await openDialog();
    const confirmBtn = [...document.querySelectorAll('button')].find(b => b.textContent === 'Remove')!;
    await act(async () => { confirmBtn.click(); });
    expect(document.querySelector('[data-testid="result"]')?.textContent).toBe('confirmed');
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('traps Tab within Cancel and Confirm', async () => {
    await openDialog();
    const cancelBtn = [...document.querySelectorAll('button')].find(b => b.textContent === 'Cancel')!;
    const confirmBtn = [...document.querySelectorAll('button')].find(b => b.textContent === 'Remove')!;

    expect(document.activeElement).toBe(cancelBtn);
    await fire(document, 'keydown', { key: 'Tab' });
    expect(document.activeElement).toBe(confirmBtn);

    await fire(document, 'keydown', { key: 'Tab' });
    expect(document.activeElement).toBe(cancelBtn);

    await fire(document, 'keydown', { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirmBtn);
  });
});
