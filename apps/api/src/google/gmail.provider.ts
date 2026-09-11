import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { GoogleConfigService } from "./google-config.service";

/**
 * One normalized message shape, whatever the source. The real Gmail provider
 * and the sandbox provider both produce this, so the sync logic that links
 * messages to clients/projects/vendors is identical in both modes and is
 * therefore actually exercised by the sandbox tests.
 */
export interface FetchedMessage {
  gmailMessageId: string;
  threadId: string;
  fromAddress: string;
  subject: string;
  snippet: string;
  receivedAt: Date;
  isUnread: boolean;
}

export interface FetchResult {
  messages: FetchedMessage[];
  /** Gmail's cursor for the next incremental call. */
  historyId: string | null;
}

export abstract class GmailProvider {
  abstract fetchSince(accessToken: string, historyId: string | null): Promise<FetchResult>;
  abstract send(accessToken: string, to: string, subject: string, body: string): Promise<{ id: string }>;
}

/**
 * Sandbox: a small, fixed set of obviously-synthetic messages, addressed from
 * example.invalid so they can never be confused with real correspondence.
 * Makes no network call and needs no credentials. Every row it produces is
 * written with `isSandbox = true`.
 */
@Injectable()
export class SandboxGmailProvider extends GmailProvider {
  async fetchSince(_accessToken: string, historyId: string | null): Promise<FetchResult> {
    const base = Number(historyId ?? 0);
    const now = Date.now();
    const messages: FetchedMessage[] = [
      {
        gmailMessageId: `sandbox-${base + 1}`,
        threadId: `sandbox-thread-${base + 1}`,
        fromAddress: "sandbox.sender@example.invalid",
        subject: "[SANDBOX] Enquiry about bar setup",
        snippet: "This is sandbox fixture data, not a real e-mail.",
        receivedAt: new Date(now - 3_600_000),
        isUnread: true,
      },
      {
        gmailMessageId: `sandbox-${base + 2}`,
        threadId: `sandbox-thread-${base + 2}`,
        fromAddress: "sandbox.vendor@example.invalid",
        subject: "[SANDBOX] Quotation attached",
        snippet: "This is sandbox fixture data, not a real e-mail.",
        receivedAt: new Date(now - 1_800_000),
        isUnread: true,
      },
    ];
    return { messages, historyId: String(base + 2) };
  }

  async send(): Promise<{ id: string }> {
    throw new ServiceUnavailableException(
      "Sandbox mode never sends mail. Configure real credentials and GOOGLE_INTEGRATION_MODE=live to send.",
    );
  }
}

/**
 * Live: the real Gmail calls, deliberately left unimplemented rather than
 * written blind.
 *
 * The request shapes are documented inline because they are the actual
 * remaining work, but no code here has ever been executed against Google —
 * AMM Brands' Workspace credentials are not available in this environment, and
 * shipping an untested "working" integration would be a claim this build
 * cannot support. It throws a clear error rather than appearing to succeed.
 */
@Injectable()
export class LiveGmailProvider extends GmailProvider {
  constructor(private readonly config: GoogleConfigService) {
    super();
  }

  async fetchSince(_accessToken: string, _historyId: string | null): Promise<FetchResult> {
    this.config.assertLive();
    // Remaining work, once credentials exist:
    //   historyId === null
    //     -> GET https://gmail.googleapis.com/gmail/v1/users/me/messages?q=newer_than:30d
    //        then batch GET .../messages/{id}?format=metadata
    //   historyId !== null
    //     -> GET .../users/me/history?startHistoryId={historyId}
    //        handle 404 (history expired) by falling back to the full path above
    //   persist the response's historyId as the next cursor
    throw new ServiceUnavailableException(
      "The live Gmail sync is not implemented: it has never been run against a real Google Workspace account, " +
        "and this build will not ship an untested integration that appears to work. See docs/integration-setup.md §Remaining work.",
    );
  }

  async send(): Promise<{ id: string }> {
    this.config.assertLive();
    // POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send
    // body: { raw: base64url(RFC 2822 message) }, scope gmail.send
    throw new ServiceUnavailableException(
      "Live Gmail send is not implemented — see docs/integration-setup.md §Remaining work.",
    );
  }
}
