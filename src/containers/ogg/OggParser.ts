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

import { headerStore, frameStore } from "../../globals";
import { bytesToString, concatBuffers } from "../../utilities";

import { Parser, ParserConstructor } from "../../codecs/Parser";
import { OggPage, getFrame } from "./OggPage";

import { FLACParser } from "../../codecs/flac/FLACParser";
import { OpusParser } from "../../codecs/opus/OpusParser";
import { VorbisParser } from "../../codecs/vorbis/VorbisParser";
import { CodecParser } from "../../CodecParser";
import { HeaderCache } from "../../codecs/HeaderCache";
import { OnCodec } from "../../types";
import { RawOggPageHeader } from "./OggPageHeader";

type NestedParser = OpusParser | FLACParser | VorbisParser;

type ParserConstructor = new (codecParser: CodecParser, headerCache: HeaderCache, onCodec?: OnCodec) => NestedParser;

export class OggParser extends Parser<OggPage> {
  private _codec?: string;
  private onCodec: OnCodec;
  private continuedPacket: Uint8Array;
  private pageSequenceNumber: number;
  private parser!: NestedParser;

  constructor(codecParser: CodecParser, headerCache: HeaderCache, onCodec: OnCodec) {
    super(codecParser, headerCache, getFrame);

    this.onCodec = onCodec;
    this.continuedPacket = new Uint8Array();

    this.pageSequenceNumber = 0;
  }

  get codec() {
    return this._codec || "";
  }

  private updateCodec(codec: string, ParserCtor: ParserConstructor) {
    if (this._codec !== codec) {
      this.parser = new ParserCtor(this.codecParser, this.headerCache);
      this._codec = codec;
      this.onCodec(codec);
    }
  }

  private checkForIdentifier({ data }: OggPage) {
    const id = bytesToString(data.subarray(0, 8));

    switch (id) {
      case "fishead\0":
      case "fisbone\0":
      case "index\0\0\0":
        return false; // ignore ogg skeleton packets
      case "OpusHead":
        // @ts-ignore
        this.updateCodec("opus", OpusParser);
        return true;
      case /^\x7fFLAC/.test(id) && id:
        // @ts-ignore
        this.updateCodec("flac", FLACParser);
        return true;
      case /^\x01vorbis/.test(id) && id:
        // @ts-ignore
        this.updateCodec("vorbis", VorbisParser);
        return true;
    }
  }

  private checkPageSequenceNumber(oggPage: OggPage) {
    if (oggPage.pageSequenceNumber !== this.pageSequenceNumber + 1 && this.pageSequenceNumber > 1 && oggPage.pageSequenceNumber > 1) {
      this.codecParser.logWarning(
        "Unexpected gap in Ogg Page Sequence Number.",
        `Expected: ${this.pageSequenceNumber + 1}, Got: ${
          oggPage.pageSequenceNumber
        }`
      );
    }

    this.pageSequenceNumber = oggPage.pageSequenceNumber;
  }

  override *parseFrame() {
    const oggPage = (yield* this.fixedLengthFrameSync(true))!;

    this.checkPageSequenceNumber(oggPage);

    const oggPageStore = frameStore.get(oggPage);
    const { pageSegmentBytes, pageSegmentTable } = headerStore.get(
      oggPageStore.header
    ) as RawOggPageHeader;

    let offset = 0;

    oggPageStore.segments = pageSegmentTable.map((segmentLength) =>
      oggPage.data.subarray(offset, (offset += segmentLength))
    );

    if (pageSegmentBytes[pageSegmentBytes.length - 1] === 0xff) {
      // continued packet
      this.continuedPacket = concatBuffers(
        this.continuedPacket,
        oggPageStore.segments.pop()
      );
    } else if (this.continuedPacket.length) {
      oggPageStore.segments[0] = concatBuffers(
        this.continuedPacket,
        oggPageStore.segments[0]
      );

      this.continuedPacket = new Uint8Array();
    }

    if (this._codec || this.checkForIdentifier(oggPage)) {
      const frame = this.parser.parseOggPage(oggPage);
      this.codecParser.mapFrameStats(frame);
      return frame;
    }
  }
}
