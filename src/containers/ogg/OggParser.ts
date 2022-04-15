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

import Parser from "../../codecs/Parser";
import OggPage, { getFrame } from "./OggPage";

import FLACParser from "../../codecs/flac/FLACParser";
import OpusParser from "../../codecs/opus/OpusParser";
import VorbisParser from "../../codecs/vorbis/VorbisParser";
import { CodecParser } from "../../CodecParser";
import HeaderCache from "../../codecs/HeaderCache";
import { OnCodec } from "../../types";
import { RawOggPageHeader } from "./OggPageHeader";

export default class OggParser extends Parser<OggPage> {
  private _codec?: string;
  private _onCodec: OnCodec;
  private _continuedPacket: Uint8Array;
  private _pageSequenceNumber: number;
  private _parser!: OpusParser | FLACParser | VorbisParser;

  constructor(codecParser: CodecParser, headerCache: HeaderCache, onCodec: OnCodec) {
    super(codecParser, headerCache, getFrame);

    this._onCodec = onCodec;
    this._continuedPacket = new Uint8Array();

    this._pageSequenceNumber = 0;
  }

  get codec() {
    return this._codec || "";
  }

  _updateCodec(codec: string, ParserClass: typeof Parser) { // TODO: newable
    if (this._codec !== codec) {
      this._parser = new ParserClass(this._codecParser, this._headerCache) as any;
      this._codec = codec;
      this._onCodec(codec);
    }
  }

  _checkForIdentifier({ data }: OggPage) {
    const idString = bytesToString(data.subarray(0, 8));

    switch (idString) {
      case "fishead\0":
      case "fisbone\0":
      case "index\0\0\0":
        return false; // ignore ogg skeleton packets
      case "OpusHead":
        // @ts-ignore
        this._updateCodec("opus", OpusParser);
        return true;
      case /^\x7fFLAC/.test(idString) && idString:
        // @ts-ignore
        this._updateCodec("flac", FLACParser);
        return true;
      case /^\x01vorbis/.test(idString) && idString:
        // @ts-ignore
        this._updateCodec("vorbis", VorbisParser);
        return true;
    }
  }

  _checkPageSequenceNumber(oggPage: OggPage) {
    if (oggPage.pageSequenceNumber !== this._pageSequenceNumber + 1 && this._pageSequenceNumber > 1 && oggPage.pageSequenceNumber > 1) {
      this._codecParser.logWarning(
        "Unexpected gap in Ogg Page Sequence Number.",
        `Expected: ${this._pageSequenceNumber + 1}, Got: ${
          oggPage.pageSequenceNumber
        }`
      );
    }

    this._pageSequenceNumber = oggPage.pageSequenceNumber;
  }

  *parseFrame() {
    const oggPage = (yield* this.fixedLengthFrameSync(true))!;

    this._checkPageSequenceNumber(oggPage);

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
      this._continuedPacket = concatBuffers(
        this._continuedPacket,
        oggPageStore.segments.pop()
      );
    } else if (this._continuedPacket.length) {
      oggPageStore.segments[0] = concatBuffers(
        this._continuedPacket,
        oggPageStore.segments[0]
      );

      this._continuedPacket = new Uint8Array();
    }

    if (this._codec || this._checkForIdentifier(oggPage)) {
      const frame = this._parser.parseOggPage(oggPage);
      this._codecParser.mapFrameStats(frame);
      return frame;
    }
  }
}
