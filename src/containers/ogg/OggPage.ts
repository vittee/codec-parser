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

import { CodecParser } from "../../CodecParser";
import { CodecFrame } from "../../codecs/CodecFrame";
import { HeaderCache } from "../../codecs/HeaderCache";
import { headerStore, frameStore } from "../../globals";
import { Frame } from "../Frame";
import { OggPageHeader, getHeader } from "./OggPageHeader";

export function *getFrame(codecParser: CodecParser, headerCache: HeaderCache, readOffset: number) {
  const header = yield* getHeader(
    codecParser,
    headerCache,
    readOffset
  );

  if (!header) {
    return;
  }
  
  const frameLength = headerStore.get(header).frameLength;
  const headerLength = headerStore.get(header).length;
  const totalLength = headerLength + frameLength;

  const rawData = (yield* codecParser.readRawData(totalLength, 0)).subarray(
    0,
    totalLength
  );

  const frame = rawData.subarray(headerLength, totalLength);

  return new OggPage(header, frame, rawData);
}

export class OggPage extends Frame<OggPageHeader> {
  codecFrames: CodecFrame<any>[];
  rawData: Uint8Array;
  absoluteGranulePosition: bigint;
  crc32: number;
  duration: number;
  isContinuedPacket: boolean;
  isFirstPage: boolean;
  isLastPage: boolean;
  pageSequenceNumber: number;
  samples: number;
  streamSerialNumber: number;

  constructor(header: OggPageHeader, frame: Uint8Array, rawData: Uint8Array) {
    super(header, frame, 0);

    frameStore.get(this).length = rawData.length;

    this.codecFrames = [];
    this.rawData = rawData;
    this.absoluteGranulePosition = header.absoluteGranulePosition;
    this.crc32 = header.pageChecksum;
    this.duration = 0;
    this.isContinuedPacket = header.isContinuedPacket;
    this.isFirstPage = header.isFirstPage;
    this.isLastPage = header.isLastPage;
    this.pageSequenceNumber = header.pageSequenceNumber;
    this.samples = 0;
    this.streamSerialNumber = header.streamSerialNumber;
  }
}
