import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getMiddleware } from './index'; // Adjust path as necessary
import type { FragmentConfig, FragmentGateway } from '../../fragment-gateway';

// Mock global fetch
global.fetch = vi.fn();

// Mock console.error
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

// Helper to create a mock FragmentGateway
const createMockGateway = (fragments: FragmentConfig[] = []): FragmentGateway => {
  const gateway = {
    matchRequestToFragment: vi.fn(),
    registerFragment: vi.fn(), // Not directly used in these tests but part of interface
    prePiercingStyles: '', // Mock property
    fragmentConfigs: new Map<string, FragmentConfig>(), // Mock property
    routeMap: new Map<any, FragmentConfig>(), // Mock property
  } as unknown as FragmentGateway; // Type assertion for simplicity

  // Populate fragmentConfigs for lookup if needed by matchRequestToFragment mock
  fragments.forEach(f => gateway.fragmentConfigs.set(f.fragmentId, f));
  return gateway;
};

// Helper to create a mock Cloudflare Pages context's `next` function
const mockNext = vi.fn();

describe('Cloudflare Pages Middleware - Error Handling', () => {
  let mockGateway: FragmentGateway;
  let baseFragmentConfig: Omit<FragmentConfig, 'fragmentId' | 'onSsrFetchError' | 'endpoint'>;

  beforeEach(() => {
    vi.resetAllMocks(); // Reset all mocks before each test

    baseFragmentConfig = {
      routePatterns: ['/test/*'],
      prePiercingClassNames: [],
    };
  });

  afterEach(() => {
    // Optional: verify console.error was not called unexpectedly, or reset its mock behavior
  });

  const executeMiddleware = async (
    request: Request,
    fragmentConfig: FragmentConfig,
    options: { mode?: 'development' | 'production' } = { mode: 'development' }
  ) => {
    mockGateway = createMockGateway([fragmentConfig]);
    vi.spyOn(mockGateway, 'matchRequestToFragment').mockReturnValue(fragmentConfig);

    const middleware = getMiddleware(mockGateway, options);
    // Mock the `next` function for the host application call chain
    // For document requests, `next()` is called to get the hostResponse.
    // We'll make it return a simple HTML response.
    mockNext.mockResolvedValue(new Response('<html><body></body></html>', { headers: { 'Content-Type': 'text/html' } }));
    
    const context = {
      request,
      next: mockNext,
      // Add other context properties if your middleware uses them (e.g., env, params)
    } as any; // Simplified Cloudflare Pages context

    return middleware(context);
  };

  // --- Test Scenarios ---

  describe('Scenario 1: onSsrFetchError is not provided', () => {
    const fragmentId = 'no-onssefetcherror-fragment';
    const endpoint = 'https://fragment-source.com/no-onssefetcherror';
    const fragmentConfig: FragmentConfig = {
      ...baseFragmentConfig,
      fragmentId,
      endpoint,
      // onSsrFetchError is undefined
    };

    it('should return standardized JSON error on fetch returning 500', async () => {
      (fetch as vi.Mock).mockResolvedValue(new Response('Internal Server Error', { status: 500 }));
      
      const request = new Request(`https://app.com/test/page1`, { headers: { 'Sec-Fetch-Dest': 'document' }});
      const response = await executeMiddleware(request, fragmentConfig);

      expect(response.status).toBe(500);
      expect(response.headers.get('Content-Type')).toBe('application/json');
      const body = await response.json();
      expect(body).toEqual({
        __isFragmentGatewayError__: true,
        message: `SSR fetch failed for fragment ${fragmentId}. Upstream endpoint: ${endpoint}`,
        status: 500,
      });
    });

    it('should return standardized JSON error on fetch throwing an error', async () => {
      const fetchError = new Error('Network failed');
      (fetch as vi.Mock).mockRejectedValue(fetchError);

      const request = new Request(`https://app.com/test/page2`, { headers: { 'Sec-Fetch-Dest': 'document' }});
      const response = await executeMiddleware(request, fragmentConfig);
      
      expect(response.status).toBe(500); // Default status for thrown error
      expect(response.headers.get('Content-Type')).toBe('application/json');
      const body = await response.json();
      expect(body).toEqual({
        __isFragmentGatewayError__: true,
        message: `SSR fetch failed for fragment ${fragmentId}. Upstream endpoint: ${endpoint}`,
        status: 500, // Status in body reflects the response status
      });
    });
  });

  describe('Scenario 2: onSsrFetchError returns { overrideResponse: true, response: customResponse }', () => {
    const fragmentId = 'override-fragment';
    const endpoint = 'https://fragment-source.com/override';
    const mockOnSsrFetchError = vi.fn();
    const fragmentConfig: FragmentConfig = {
      ...baseFragmentConfig,
      fragmentId,
      endpoint,
      onSsrFetchError: mockOnSsrFetchError,
    };

    it('should return the customResponse directly', async () => {
      (fetch as vi.Mock).mockResolvedValue(new Response('Upstream Error', { status: 503 }));
      const customHtmlResponse = new Response('<h1>Custom Fallback HTML</h1>', { 
        status: 200, // Consumer can choose to return 200 for their fallback
        headers: { 'Content-Type': 'text/html' } 
      });
      mockOnSsrFetchError.mockResolvedValue({ response: customHtmlResponse, overrideResponse: true });

      const request = new Request(`https://app.com/test/override-page`, { headers: { 'Sec-Fetch-Dest': 'document' }});
      const response = await executeMiddleware(request, fragmentConfig);

      expect(mockOnSsrFetchError).toHaveBeenCalledTimes(1);
      expect(response).toBe(customHtmlResponse);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toBe('<h1>Custom Fallback HTML</h1>');
    });
  });

  describe('Scenario 3: onSsrFetchError logs error, does not override response', () => {
    const fragmentId = 'log-only-fragment';
    const endpoint = 'https://fragment-source.com/log-only';
    const mockOnSsrFetchError = vi.fn();
    const fragmentConfig: FragmentConfig = {
      ...baseFragmentConfig,
      fragmentId,
      endpoint,
      onSsrFetchError: mockOnSsrFetchError,
    };

    it('should return standardized JSON error if onSsrFetchError returns { overrideResponse: false }', async () => {
      const upstreamErrorResponse = new Response('Upstream Error', { status: 502 });
      (fetch as vi.Mock).mockResolvedValue(upstreamErrorResponse);
      
      // Simulate onSsrFetchError logging and returning a response, but not overriding
      const loggedResponse = new Response('Logged, but not used', { status: 200 });
      mockOnSsrFetchError.mockResolvedValue({ response: loggedResponse, overrideResponse: false });

      const request = new Request(`https://app.com/test/logpage1`, { headers: { 'Sec-Fetch-Dest': 'document' }});
      const response = await executeMiddleware(request, fragmentConfig);

      expect(mockOnSsrFetchError).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(502); // Status from original upstream error
      expect(response.headers.get('Content-Type')).toBe('application/json');
      const body = await response.json();
      expect(body).toEqual({
        __isFragmentGatewayError__: true,
        message: `SSR fetch failed for fragment ${fragmentId}. Upstream endpoint: ${endpoint}`,
        status: 502,
      });
    });

    it('should return standardized JSON error if onSsrFetchError returns only logs (undefined)', async () => {
      const upstreamErrorResponse = new Response('Another Upstream Error', { status: 404 });
      (fetch as vi.Mock).mockResolvedValue(upstreamErrorResponse);
      mockOnSsrFetchError.mockResolvedValue(undefined); // Simulates just logging

      const request = new Request(`https://app.com/test/logpage2`, { headers: { 'Sec-Fetch-Dest': 'document' }});
      const response = await executeMiddleware(request, fragmentConfig);

      expect(mockOnSsrFetchError).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(404);
      expect(response.headers.get('Content-Type')).toBe('application/json');
      const body = await response.json();
      expect(body).toEqual({
        __isFragmentGatewayError__: true,
        message: `SSR fetch failed for fragment ${fragmentId}. Upstream endpoint: ${endpoint}`,
        status: 404,
      });
    });
  });

  describe('Scenario 4: onSsrFetchError itself throws an error', () => {
    const fragmentId = 'onssefetcherror-throws-fragment';
    const endpoint = 'https://fragment-source.com/onssefetcherror-throws';
    const mockOnSsrFetchError = vi.fn();
    const fragmentConfig: FragmentConfig = {
      ...baseFragmentConfig,
      fragmentId,
      endpoint,
      onSsrFetchError: mockOnSsrFetchError,
    };

    it('should return standardized JSON error and log the internal error', async () => {
      const upstreamFetchError = new Response('Upstream Problem', { status: 500 });
      (fetch as vi.Mock).mockResolvedValue(upstreamFetchError);
      
      const internalError = new Error('Error inside onSsrFetchError');
      mockOnSsrFetchError.mockRejectedValue(internalError); // Simulate onSsrFetchError throwing

      const request = new Request(`https://app.com/test/internalerrorpage`, { headers: { 'Sec-Fetch-Dest': 'document' }});
      const response = await executeMiddleware(request, fragmentConfig);

      expect(mockOnSsrFetchError).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(500); // Status from original upstream error
      expect(response.headers.get('Content-Type')).toBe('application/json');
      const body = await response.json();
      expect(body).toEqual({
        __isFragmentGatewayError__: true,
        message: `SSR fetch failed for fragment ${fragmentId}. Upstream endpoint: ${endpoint}`,
        status: 500,
      });
      // Check if console.error was called with the internal error
      expect(mockConsoleError).toHaveBeenCalledWith(`Error in onSsrFetchError for fragment ${fragmentId}:`, internalError);
    });
  });

  describe('Scenario 5: Upstream fetch is successful (HTTP 200 OK)', () => {
    const fragmentId = 'success-fragment';
    const endpoint = 'https://fragment-source.com/success';
    const mockOnSsrFetchError = vi.fn(); // Should not be called
    const fragmentConfig: FragmentConfig = {
      ...baseFragmentConfig,
      fragmentId,
      endpoint,
      onSsrFetchError: mockOnSsrFetchError,
      // For simplicity, we'll assume this successful response doesn't need full HTML rewriting for this test.
      // The core check is that onSsrFetchError is NOT called.
      forwardFragmentHeaders: [], 
      prePiercingClassNames: [],
    };

    it('should not call onSsrFetchError and proceed normally', async () => {
      const successfulUpstreamResponse = new Response('<p>Fragment Content</p>', { 
        status: 200, 
        headers: { 'Content-Type': 'text/html' } 
      });
      (fetch as vi.Mock).mockResolvedValue(successfulUpstreamResponse);
      
      // Mock host response for document request
      const hostResponse = new Response('<html><head></head><body></body></html>', { 
        status: 200, 
        headers: { 'Content-Type': 'text/html'} 
      });
      mockNext.mockResolvedValue(hostResponse);


      const request = new Request(`https://app.com/test/successpage`, { headers: { 'Sec-Fetch-Dest': 'document' }});
      const response = await executeMiddleware(request, fragmentConfig);

      expect(mockOnSsrFetchError).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(1); // Ensure fetch was called
      
      // Check that the response is the transformed host response
      // This part depends heavily on the non-error path logic (HTMLRewriter)
      // For this error-focused test suite, we'll just check it's not an error response.
      expect(response.status).toBe(200); 
      expect(response.headers.get('Content-Type')).toContain('text/html');
      const text = await response.text();
      expect(text).toContain('<fragment-host'); // Basic check for fragment embedding
      expect(text).toContain('Fragment Content');
    });

    it('should just return fragment response if not a document request', async () => {
        const successfulUpstreamResponse = new Response('<p>Fragment Content</p>', { 
            status: 200, 
            headers: { 'Content-Type': 'text/html' } 
        });
        (fetch as vi.Mock).mockResolvedValue(successfulUpstreamResponse.clone()); // Clone for multiple reads if necessary

        const request = new Request(`https://app.com/test/successpage_non_doc`, { headers: { 'Sec-Fetch-Dest': 'empty' }}); // Not a document
        const response = await executeMiddleware(request, fragmentConfig);

        expect(mockOnSsrFetchError).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toBe('<p>Fragment Content</p>'); // Should be the direct fragment response
    });

  });
});
