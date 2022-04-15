import type { CodecParser } from "./CodecParser";
import type { CodecHeader } from "./codecs/CodecHeader";
import type { HeaderCache } from "./codecs/HeaderCache";
import type { Frame } from "./containers/Frame";
import type { Header } from "./containers/Frame";

export type RawHeader = {
  length: number;
}

export type OnCodec = (codec: string) => any;
export type OnCodecUpdate = (header: CodecHeader, timestamp: number) => any;

export type GetHeader<H extends Header> = (codecParser: CodecParser, headerCache: HeaderCache, readOffset: number) => Generator<Uint8Array, H | undefined>;
export type GetFrame<F extends Frame<any>> = (codecParcer: CodecParser, headerCache: HeaderCache, readOffset: number) => Generator<Uint8Array | undefined, F | undefined>;

export type FrameHeaderOf<F extends Frame<any>> = F extends Frame<infer H> ? H : never;