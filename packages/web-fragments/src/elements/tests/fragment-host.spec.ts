import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FragmentHost } from '../fragment-host';
import { defineElements } from '../register';

// Mock the 'reframed' library
vi.mock('reframed', () => ({
  reframed: vi.fn(),
}));

// Define custom elements for testing if not already defined
if (!customElements.get('fragment-host')) {
  defineElements(); // This will also define fragment-outlet if not already defined
}

describe('FragmentHost', () => {
  let container: HTMLElement;
  // Get a reference to the mocked reframed function
  const mockReframed = await import('reframed').then(m => m.reframed);

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // Reset the mock before each test
    mockReframed.mockReset();
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('should dispatch "fragment-host-error" when reframed calls errorHandler', async () => {
    const simulatedError = new Error('Reframed failed to load');
    mockReframed.mockImplementation((_src, options) => {
      // Simulate reframed calling the errorHandler
      if (options && typeof options.errorHandler === 'function') {
        // Call it asynchronously like reframed might
        Promise.resolve().then(() => options.errorHandler(simulatedError));
      }
      return {
        iframe: document.createElement('iframe'),
        ready: Promise.resolve(),
      };
    });

    const fragmentHost = document.createElement('fragment-host') as FragmentHost;
    fragmentHost.setAttribute('fragment-id', 'test-host-id'); // Required for initialization path

    const errorSpy = vi.fn();
    fragmentHost.addEventListener('fragment-host-error', errorSpy);

    container.appendChild(fragmentHost);

    // Wait for the asynchronous error handler to be called
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const event = errorSpy.mock.calls[0][0] as CustomEvent;

    expect(event.type).toBe('fragment-host-error');
    expect(event.detail).toBeDefined();
    expect(event.detail.originalError).toBe(simulatedError);
    expect(event.detail.processedError).toBe(simulatedError); // Because no gateway details were parsed
    expect(event.detail.gatewayErrorDetails).toBeNull();
  });

  it('should initialize correctly if reframed succeeds', () => {
    mockReframed.mockReturnValue({
      iframe: document.createElement('iframe'),
      ready: Promise.resolve(),
    });

    const fragmentHost = document.createElement('fragment-host') as FragmentHost;
    fragmentHost.setAttribute('fragment-id', 'test-host-id-success');
    const errorSpy = vi.fn();
    fragmentHost.addEventListener('fragment-host-error', errorSpy);

    container.appendChild(fragmentHost);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(fragmentHost.isInitialized).toBe(true);
    expect(fragmentHost.iframe).toBeInstanceOf(HTMLIFrameElement);
  });

  it('should attempt to parse gateway error details from error message if present', async () => {
    const gatewayJsonError = {
      __isFragmentGatewayError__: true,
      message: 'SSR fetch failed for fragment test-gateway-error',
      status: 500,
    };
    const errorMessageFromReframed = `Failed to load: ${JSON.stringify(gatewayJsonError)}`;
    const simulatedError = new Error(errorMessageFromReframed);

    mockReframed.mockImplementation((_src, options) => {
      if (options && typeof options.errorHandler === 'function') {
        Promise.resolve().then(() => options.errorHandler(simulatedError));
      }
      return {
        iframe: document.createElement('iframe'),
        ready: Promise.resolve(),
      };
    });

    const fragmentHost = document.createElement('fragment-host') as FragmentHost;
    fragmentHost.setAttribute('fragment-id', 'test-gateway-error');

    const errorSpy = vi.fn();
    fragmentHost.addEventListener('fragment-host-error', errorSpy);
    container.appendChild(fragmentHost);

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const event = errorSpy.mock.calls[0][0] as CustomEvent;

    expect(event.type).toBe('fragment-host-error');
    expect(event.detail).toBeDefined();
    expect(event.detail.originalError).toBe(simulatedError);
    expect(event.detail.processedError).toBeInstanceOf(Error);
    expect(event.detail.processedError.message).toBe(
      `Fragment Host Error: Gateway responded with status 500. Message: "SSR fetch failed for fragment test-gateway-error"`
    );
    expect(event.detail.gatewayErrorDetails).toEqual(gatewayJsonError);
  });

   it('should gracefully handle non-JSON error messages when trying to parse gateway details', async () => {
    const simulatedError = new Error('A generic non-JSON error message from reframed');

    mockReframed.mockImplementation((_src, options) => {
      if (options && typeof options.errorHandler === 'function') {
        Promise.resolve().then(() => options.errorHandler(simulatedError));
      }
      return {
        iframe: document.createElement('iframe'),
        ready: Promise.resolve(),
      };
    });

    const fragmentHost = document.createElement('fragment-host') as FragmentHost;
    fragmentHost.setAttribute('fragment-id', 'test-generic-error');

    const errorSpy = vi.fn();
    fragmentHost.addEventListener('fragment-host-error', errorSpy);
    container.appendChild(fragmentHost);

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const event = errorSpy.mock.calls[0][0] as CustomEvent;
    
    expect(event.type).toBe('fragment-host-error');
    expect(event.detail).toBeDefined();
    expect(event.detail.originalError).toBe(simulatedError);
    expect(event.detail.processedError).toBe(simulatedError); // Should fallback to originalError
    expect(event.detail.gatewayErrorDetails).toBeNull(); // No gateway details should be parsed
  });
});
