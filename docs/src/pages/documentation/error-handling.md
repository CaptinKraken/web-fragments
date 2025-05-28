---
title: Error Handling
description: Learn how to handle errors in FragmentHost, FragmentOutlet, and FragmentGateway.
---

## Error Handling Overview

Effective error handling is crucial for building robust applications with web fragments. This guide covers client-side error handling for `FragmentHost` and `FragmentOutlet` components, and server-side error handling within the `FragmentGateway`.

## Client-Side Error Handling

Both `FragmentHost` and `FragmentOutlet` components dispatch custom events to signal errors that occur during their lifecycle. These events bubble up the DOM tree and are composed, meaning they can be caught by listeners on parent elements.

### `FragmentHost` Error Handling

`FragmentHost` dispatches a `fragment-host-error` event when an error occurs. This can happen, for example, during the initialization of the `reframed` library (which loads the fragment's content into an iframe) or if the gateway returns an error when fetching the fragment's SSR content.

The `fragment-host-error` is a `CustomEvent`. The error details are found in the `event.detail` object, which contains the following properties:

-   `originalError` (`Error`): The original error object caught, often from the `reframed` library.
-   `processedError` (`Error`): An error object that might have an enhanced message if specific gateway error details were parsed. If no specific details were parsed, this will be the same as `originalError`.
-   `gatewayErrorDetails` (`object | null`): If the error originated from a `FragmentGateway` JSON error response, this object will contain `{ message: string, status: number, __isFragmentGatewayError__?: boolean }`. It will be `null` if the error is not a recognized gateway error or if details couldn't be parsed.

**Example:**

```html
<fragment-host fragment-id="my-fragment"></fragment-host>
<script>
  const fragmentHost = document.querySelector('fragment-host[fragment-id="my-fragment"]');
  fragmentHost.addEventListener('fragment-host-error', (event) => {
    // event is now a CustomEvent
    const { originalError, processedError, gatewayErrorDetails } = event.detail;

    console.error('Error in fragment host:', processedError.message);
    console.log('Original error from reframed:', originalError);

    if (gatewayErrorDetails) {
      console.log('Gateway error details:', gatewayErrorDetails);
      // Example: Send more detailed error to Sentry
      // Sentry.captureException(processedError, {
      //   extra: { ...gatewayErrorDetails, fragmentId: 'my-fragment' }
      // });
    } else {
      // Example: Send processed error to Sentry
      // Sentry.captureException(processedError, {
      //   extra: { fragmentId: 'my-fragment' }
      // });
    }
  });
</script>
```

### `FragmentOutlet` Error Handling

`FragmentOutlet` dispatches a `fragment-outlet-error` event when an error occurs. A common cause for this event is a missing or mismatched `fragment-id` attribute, preventing it from finding its corresponding `FragmentHost`.

The event object (currently an `ErrorEvent`) contains an `error` property with the actual error that occurred.

**Example:**

```html
<fragment-outlet fragment-id="my-fragment"></fragment-outlet>
<script>
  const fragmentOutlet = document.querySelector('fragment-outlet[fragment-id="my-fragment"]');
  fragmentOutlet.addEventListener('fragment-outlet-error', (event) => {
    console.error('Error in fragment outlet:', event.error);
    // Example: Send to Sentry
    // Sentry.captureException(event.error, {
    //   extra: { fragmentId: 'my-fragment' }
    // });
  });
</script>
```

## Server-Side Error Handling (`FragmentGateway`)

The `FragmentGateway` provides a mechanism to handle errors that occur when fetching Server-Side Rendered (SSR) content from a fragment's endpoint. This is configured via the `onSsrFetchError` callback in your `FragmentConfig`.

### `onSsrFetchError` Callback

When you register a fragment with the `FragmentGateway`, you can provide an `onSsrFetchError` function in its configuration. This function is called if the `fetch` request to the fragment's `endpoint` fails (e.g., network error, 4xx or 5xx status code).

**Parameters:**

-   `req` (`RequestInfo`): The original request object (or URL string) that was sent to the fragment's endpoint.
-   `failedResOrError` (`Response | unknown`):
    -   If the fetch completed but resulted in an HTTP error (e.g., status 404, 500), this will be the `Response` object.
    -   If the fetch failed due to a network error or other issue before a response was received, this will be the `Error` object thrown by `fetch`.

**Return Value:**

The callback should return an object or a Promise resolving to an object of type `SSRFetchErrorResponse`:

```typescript
interface SSRFetchErrorResponse {
  response: Response | null; // The Response to send, or null to let gateway handle it
  overrideResponse?: boolean; // If true, your 'response' is sent directly to the client
}
```

-   `response` (`Response | null`):
    -   Provide a `Response` object if you want to send custom HTML, JSON, or any other content to the client for this fragment.
    -   Set to `null` (or return `{ overrideResponse: false }` or simply nothing) if you only want to log the error and let the gateway handle sending an error response.
-   `overrideResponse` (`boolean`, optional, defaults to `false`):
    -   If `true`, the `response` you provide will be sent directly to the client as the SSR content for the fragment. The gateway will not attempt to embed this into the host page if it's not HTML, nor will it generate its default error.
    -   If `false` or not provided, and your `response` is HTML, the gateway will attempt to use it. If your `response` is `null` or not HTML, the gateway will send its own standardized JSON error response to the client (e.g., `{"__isFragmentGatewayError__": true, ...}`). This JSON error can then be caught and handled by `FragmentHost` on the client-side, potentially populating `event.detail.gatewayErrorDetails`.

**Example Configuration:**

```typescript
// Example of FragmentConfig for FragmentGateway
const myFragmentConfig = {
  fragmentId: 'my-service-fragment',
  routePatterns: ['/my-service/*'],
  endpoint: 'https://my-service-endpoint.com/fragment',
  // ... other config ...
  onSsrFetchError: async (req, failedResOrError) => {
    const requestUrl = typeof req === 'string' ? req : req.url;
    console.error(`SSR Fetch Error for fragment ${myFragmentConfig.fragmentId} (URL: ${requestUrl}):`, failedResOrError);

    // You might want to report this error to an external service (see Sentry section below)

    // Option 1: Log the error and let the gateway propagate its default JSON error to the client.
    // This allows FragmentHost to provide specific client-side feedback.
    // return { response: null, overrideResponse: false }; // Or simply return; or return {};

    // Option 2: Provide a custom fallback HTML response for specific errors.
    if (failedResOrError instanceof Response && failedResOrError.status === 404) {
      return {
        response: new Response('<h3>Fragment not found by upstream. Displaying custom fallback.</h3>', {
          status: 404, // You can set the status for the client too
          headers: { 'Content-Type': 'text/html' }
        }),
        overrideResponse: true // Send this HTML directly
      };
    }

    // Option 3: Provide a generic custom fallback HTML for other errors.
    return {
      response: new Response('<h3>Sorry, this part of the page could not be loaded due to an issue.</h3>', {
        status: 500, // Or an appropriate status from failedResOrError
        headers: { 'Content-Type': 'text/html' }
      }),
      overrideResponse: true // Send this HTML directly
    };
  }
};

// Presuming 'gateway' is an instance of FragmentGateway
// gateway.registerFragment(myFragmentConfig);
```

## Integration with Error Reporting Services (e.g., Sentry)

You can integrate error reporting services like Sentry at various points to capture and analyze errors from web fragments.

### Client-Side (in `FragmentHost`)

As shown in the `FragmentHost` example earlier, you can use the `fragment-host-error` event to send errors to Sentry. Accessing `event.detail` allows for richer error reporting.

```javascript
// Inside the fragment-host-error event listener:
// import * as Sentry from '@sentry/browser'; // Or your Sentry SDK

fragmentHost.addEventListener('fragment-host-error', (event) => {
  const { originalError, processedError, gatewayErrorDetails } = event.detail;
  const fragmentId = event.target.getAttribute('fragment-id');

  if (gatewayErrorDetails) {
    Sentry.captureException(processedError, {
      extra: {
        ...gatewayErrorDetails,
        fragmentId: fragmentId,
        originalErrorMessage: originalError.message,
      },
      tags: { fragmentId: fragmentId }
    });
  } else {
    Sentry.captureException(processedError, {
      extra: {
        fragmentId: fragmentId,
        originalErrorMessage: originalError.message,
      },
      tags: { fragmentId: fragmentId }
    });
  }
});
```

### Server-Side (in `onSsrFetchError`)

In the `FragmentGateway`, the `onSsrFetchError` callback is an ideal place to report server-side issues encountered while fetching fragment content.

```typescript
// Example within onSsrFetchError in your gateway setup:
// import * as Sentry from '@sentry/node'; // Or your server-side Sentry SDK

// Initialize Sentry in your gateway/worker entry point if not already done.

const myFragmentConfig = {
  fragmentId: 'critical-fragment',
  // ... other config ...
  onSsrFetchError: async (req, failedResOrError) => {
    const requestUrl = typeof req === 'string' ? req : req.url;
    const errorToSend = failedResOrError instanceof Response ?
      new Error(`HTTP error ${failedResOrError.status} for fragment ${myFragmentConfig.fragmentId} at ${requestUrl}`) :
      failedResOrError; // Should be an Error object already

    Sentry.captureException(errorToSend, {
      extra: {
        fragmentId: myFragmentConfig.fragmentId,
        requestUrl: requestUrl,
        isHttpResponseError: failedResOrError instanceof Response,
        ...(failedResOrError instanceof Response && { responseStatus: failedResOrError.status })
      },
      tags: { fragmentId: myFragmentConfig.fragmentId }
    });

    // Decide on fallback behavior (as shown in previous examples)
    // For instance, let the gateway return its JSON error to be handled by FragmentHost:
    return { response: null, overrideResponse: false };
  }
};
```

**Note:** The exact Sentry SDK methods and configuration options may vary depending on your environment (Node.js, Cloudflare Workers, browser) and Sentry version. Always refer to the official Sentry documentation for the most accurate guidance.

By listening to these events and using callbacks, you can gracefully handle errors, provide a better user experience, and effectively monitor the health of your fragmented application.
