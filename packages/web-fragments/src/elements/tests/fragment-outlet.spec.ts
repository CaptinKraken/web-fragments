import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FragmentOutlet } from '../fragment-outlet';
import { defineElements } from '../register';

// Define custom elements for testing if not already defined
if (!customElements.get('fragment-outlet')) {
  defineElements();
}

describe('FragmentOutlet', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('should dispatch "fragment-outlet-error" if fragment-id is missing', () => {
    const fragmentOutlet = document.createElement('fragment-outlet') as FragmentOutlet;
    const errorSpy = vi.fn();

    fragmentOutlet.addEventListener('fragment-outlet-error', errorSpy);
    container.appendChild(fragmentOutlet);

    // The error is dispatched in connectedCallback, which is synchronous for custom elements
    // if they are created and appended this way.

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const event = errorSpy.mock.calls[0][0] as ErrorEvent;
    expect(event.type).toBe('fragment-outlet-error');
    expect(event.error).toBeInstanceOf(Error);
    expect(event.error.message).toBe('The fragment outlet component has been applied without providing a fragment-id');
  });

  it('should not dispatch "fragment-outlet-error" if fragment-id is provided', () => {
    const fragmentOutlet = document.createElement('fragment-outlet') as FragmentOutlet;
    fragmentOutlet.setAttribute('fragment-id', 'test-id');
    const errorSpy = vi.fn();

    fragmentOutlet.addEventListener('fragment-outlet-error', errorSpy);
    container.appendChild(fragmentOutlet);

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('should set fragmentId property when attribute is set', () => {
    const fragmentOutlet = document.createElement('fragment-outlet') as FragmentOutlet;
    fragmentOutlet.setAttribute('fragment-id', 'test-id-prop');
    container.appendChild(fragmentOutlet);
    expect(fragmentOutlet.fragmentId).toBe('test-id-prop');
  });
});
