import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

let fail = true;
function Bomb() {
  if (fail) throw new Error('boom');
  return <p>fine</p>;
}

describe('ErrorBoundary (S21)', () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fail = true;
    spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => spy.mockRestore());

  it('shows a fallback for the region only, and "Try again" re-mounts it', () => {
    const onError = vi.fn();
    render(
      <>
        <p>sibling</p>
        <ErrorBoundary name="Inspector" onError={onError}>
          <Bomb />
        </ErrorBoundary>
      </>,
    );
    expect(screen.getByText('sibling')).toBeInTheDocument();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Inspector hit an error');
    expect(alert).toHaveTextContent('boom');
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'boom' }),
      expect.anything(),
    );
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('fine')).toBeInTheDocument();
  });

  it('clears the error when resetKey changes (e.g. another board)', () => {
    function Host() {
      const [k, setK] = useState(1);
      return (
        <>
          <button type="button" onClick={() => setK(2)}>
            switch
          </button>
          <ErrorBoundary name="Canvas" resetKey={k} compact>
            <Bomb />
          </ErrorBoundary>
        </>
      );
    }
    render(<Host />);
    expect(screen.getByTestId('error-fallback')).toHaveAttribute('data-region', 'Canvas');
    expect(screen.queryByText('Copy details')).toBeNull(); // compact
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'switch' }));
    expect(screen.getByText('fine')).toBeInTheDocument();
  });
});
