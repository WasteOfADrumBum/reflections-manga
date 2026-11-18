/**
 * Object storage for generated images and uploaded references. Binaries live
 * here; their metadata lives in Postgres. Production uses a PRIVATE Vercel
 * Blob store, so nothing is reachable without going through the authenticated
 * asset route.
 */
export interface StoredBlob {
  pathname: string;
  size: number;
  contentType: string;
}

export interface BlobStore {
  /** Writes a new object. Fails if the pathname already exists (no overwrites). */
  put(pathname: string, data: Buffer, contentType: string): Promise<StoredBlob>;
  get(pathname: string): Promise<{ data: Buffer; contentType: string } | null>;
  exists(pathname: string): Promise<boolean>;
}

export class BlobExistsError extends Error {
  constructor(pathname: string) {
    super(`Blob already exists: ${pathname}`);
  }
}

export function assertSafePathname(pathname: string) {
  if (!/^[a-z0-9][a-z0-9/_.-]{0,240}$/i.test(pathname) || pathname.includes("..") || pathname.includes("//")) {
    throw new Error("Unsafe blob pathname");
  }
}

/** In-memory store for tests and local development without Vercel. */
export class MemoryBlobStore implements BlobStore {
  readonly objects = new Map<string, { data: Buffer; contentType: string }>();
  async put(pathname: string, data: Buffer, contentType: string) {
    assertSafePathname(pathname);
    if (this.objects.has(pathname)) throw new BlobExistsError(pathname);
    this.objects.set(pathname, { data: Buffer.from(data), contentType });
    return { pathname, size: data.byteLength, contentType };
  }
  async get(pathname: string) {
    const o = this.objects.get(pathname);
    return o ? { data: Buffer.from(o.data), contentType: o.contentType } : null;
  }
  async exists(pathname: string) {
    return this.objects.has(pathname);
  }
}

/** Private Vercel Blob store (OIDC auth on Vercel, BLOB_READ_WRITE_TOKEN elsewhere). */
export class VercelBlobStore implements BlobStore {
  async put(pathname: string, data: Buffer, contentType: string) {
    assertSafePathname(pathname);
    const { put } = await import("@vercel/blob");
    try {
      const res = await put(pathname, data, {
        access: "private",
        contentType,
        addRandomSuffix: false,
        allowOverwrite: false,
      });
      return { pathname: res.pathname, size: data.byteLength, contentType };
    } catch (err) {
      if (err instanceof Error && /already exists/i.test(err.message)) throw new BlobExistsError(pathname);
      throw err;
    }
  }
  async get(pathname: string) {
    assertSafePathname(pathname);
    const { get } = await import("@vercel/blob");
    const res = await get(pathname, { access: "private", useCache: false });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    const data = Buffer.from(await new Response(res.stream).arrayBuffer());
    return { data, contentType: res.blob.contentType };
  }
  async exists(pathname: string) {
    assertSafePathname(pathname);
    const { head, BlobNotFoundError } = await import("@vercel/blob");
    try {
      await head(pathname);
      return true;
    } catch (err) {
      if (err instanceof BlobNotFoundError) return false;
      throw err;
    }
  }
}
