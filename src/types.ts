/** Core domain types for CiteGuard. */

/** A single claim paired with the source that allegedly supports it. */
export interface Claim {
  /** Stable identifier within one verification request. */
  id: string;
  /** The claim text as it appears in the document. */
  text: string;
  /** URL or DOI the claim cites. */
  source: string;
  /** Optional surrounding context (sentence/paragraph the claim came from). */
  context?: string;
}

export type Verdict =
  | "supported"
  | "partially_supported"
  | "contradicted"
  | "unsupported"
  | "uncertain"
  | "could_not_fetch";

/** Result of checking whether a source is alive and is what it claims to be. */
export interface SourceStatus {
  /** Final URL after redirects. */
  resolvedUrl: string;
  /** HTTP status of the final response, 0 when the fetch itself failed. */
  httpStatus: number;
  ok: boolean;
  /** True when the fetch was served from the archive.org fallback. */
  fromArchive: boolean;
  /** Set when a redirect landed on a homepage / root path, which usually
   * means the original deep link is gone. */
  redirectedToRoot: boolean;
  contentType: string;
  error?: string;
}

export interface ClaimVerdict {
  claimId: string;
  claim: string;
  source: string;
  verdict: Verdict;
  /** 0-1; judge confidence in the verdict. 0 for could_not_fetch. */
  confidence: number;
  /** Verbatim quote from the fetched source that the verdict rests on.
   * Empty for could_not_fetch / unsupported-because-absent. */
  evidence: string;
  /** One-sentence machine-generated explanation. */
  reasoning: string;
  sourceStatus: SourceStatus;
}

export interface DocumentReport {
  verdicts: ClaimVerdict[];
  /** 0-100. Weighted share of claims that are supported. */
  integrityScore: number;
  summary: {
    total: number;
    supported: number;
    partiallySupported: number;
    contradicted: number;
    unsupported: number;
    uncertain: number;
    couldNotFetch: number;
  };
}

/** Content extracted from a fetched source, ready for the judge. */
export interface ExtractedContent {
  title: string;
  /** Cleaned plain text (boilerplate stripped). */
  text: string;
  /** Truncated to the extraction cap? */
  truncated: boolean;
}

/** Minimal chat-completion interface so judges stay provider-agnostic. */
export interface JudgeClient {
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
  /** Provider label used in reports, e.g. "qwen-max", "workers-ai". */
  readonly model: string;
}
