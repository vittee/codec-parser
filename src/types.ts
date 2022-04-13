import CodecHeader from "./codecs/CodecHeader";

export type OnCodecUpdate = (header: CodecHeader, timestamp: number) => any;