/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/

import { frameStore, headerStore } from "../globals";
import Frame, { Header } from "../containers/Frame";
import CodecHeader from "./CodecHeader";
import { CodecParser } from "../CodecParser";
import HeaderCache from "./HeaderCache";
import { GetHeader } from "../types";

export type FrameFactory<F extends Frame<any>, H extends Header> = new (header: H, data: Uint8Array, samples: number) => F;

export function* getCodecFrame<F extends CodecFrame<any>, H extends Header>(
  getHeader: GetHeader<H>,
  frameFactory: FrameFactory<F, H>,
  codecParser: CodecParser,
  headerCache: HeaderCache,
  readOffset: number)
  : Generator<Uint8Array | undefined, F | null, Uint8Array> {

  const header = yield* getHeader(
    codecParser,
    headerCache,
    readOffset
  );

  if (!header) {
    return null;
  }

  const frameLength = headerStore.get(header).frameLength;
  const samples = headerStore.get(header).samples;

  const frame = (yield* codecParser.readRawData(
    frameLength,
    readOffset
  )).subarray(0, frameLength);

  return new frameFactory(header, frame, samples);
}

export class CodecFrame<H extends CodecHeader = CodecHeader> extends Frame<H> {
  constructor(readonly header: H, data: Uint8Array, readonly samples: number) {
    super(header, data, samples);

    this.duration = (samples / header.sampleRate) * 1000;
    this.frameNumber = 0;
    this.totalBytesOut = 0;
    this.totalSamples = 0;
    this.totalDuration = 0;

    frameStore.get(this).length = data.length;
  }

  crc32: number = 0;

  duration: number;

  frameNumber: number;
}
