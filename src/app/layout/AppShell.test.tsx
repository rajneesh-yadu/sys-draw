import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';

describe('AppShell', () => {
  it('renders all five shell regions', () => {
    render(<AppShell />);
    for (const id of ['topbar', 'palette', 'canvas', 'inspector', 'metrics']) {
      expect(screen.getByTestId(`region-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { name: 'SysDraw' })).toBeInTheDocument();
  });

  it('collapses and expands the metrics drawer', () => {
    render(<AppShell />);
    const toggle = screen.getByRole('button', { name: 'Hide' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Show' })).toHaveAttribute('aria-expanded', 'false');
  });
});
