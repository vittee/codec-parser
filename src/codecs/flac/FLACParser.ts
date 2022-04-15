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
import OggPage from "../../containers/ogg/OggPage";
import { frameStore, headerStore } from "../../globals";
import { OnCodec } from "../../types";
import HeaderCache from "../HeaderCache";
import Parser from "../Parser";
import FLACFrame, { checkFrameFooterCrc16 } from "./FLACFrame";
import { getHeader, getHeaderFromUint8Array, RawFLACHeader } from "./FLACHeader";

const MIN_FLAC_FRAME_SIZE = 2;
const MAX_FLAC_FRAME_SIZE = 512 * 1024;

export default class FLACParser extends Parser<FLACFrame> {
  _streamInfo: Uint8Array;
  constructor(codecParser: CodecParser, headerCache: HeaderCache, _onCodec: OnCodec) {
    super(codecParser, headerCache);
  }

  get codec() {
    return "flac";
  }

  *_getNextFrameSyncOffset(offset: number) {
    const data = yield* this._codecParser.readRawData(2, 0);
    const dataLength = data.length - 2;

    while (offset < dataLength) {
      // * `11111111|111110..`: Frame sync
      // * `........|......0.`: Reserved 0 - mandatory, 1 - reserved
      const firstByte = data[offset];
      if (firstByte === 0xff) {
        const secondByte = data[offset + 1];
        if (secondByte === 0xf8 || secondByte === 0xf9) break;
        if (secondByte !== 0xff) offset++; // might as well check for the next sync byte
      }
      offset++;
    }

    return offset;
  }

  *parseFrame() {
    // find the first valid frame header
    do {
      const header = yield* getHeader(
        this._codecParser,
        this._headerCache,
        0
      );

      if (header) {
        // found a valid frame header
        // find the next valid frame header
        let nextHeaderOffset =
          headerStore.get(header).length + MIN_FLAC_FRAME_SIZE;

        while (nextHeaderOffset <= MAX_FLAC_FRAME_SIZE) {
          if (
            this._codecParser._flushing ||
            (yield* getHeader(
              this._codecParser,
              this._headerCache,
              nextHeaderOffset
            ))
          ) {
            // found a valid next frame header
            let frameData = yield* this._codecParser.readRawData(
              nextHeaderOffset
            );

            if (!this._codecParser._flushing)
              frameData = frameData.subarray(0, nextHeaderOffset);

            // check that this is actually the next header by validating the frame footer crc16
            if (checkFrameFooterCrc16(frameData)) {
              // both frame headers, and frame footer crc16 are valid, we are synced (odds are pretty low of a false positive)
              const frame = new FLACFrame(frameData, header);

              this._headerCache.enable(); // start caching when synced
              this._codecParser.incrementRawData(nextHeaderOffset); // increment to the next frame
              this._codecParser.mapFrameStats(frame);

              return frame;
            }
          }

          nextHeaderOffset = yield* this._getNextFrameSyncOffset(
            nextHeaderOffset + 1
          );
        }

        this._codecParser.logWarning(
          `Unable to sync FLAC frame after searching ${nextHeaderOffset} bytes.`
        );
        this._codecParser.incrementRawData(nextHeaderOffset);
      } else {
        // not synced, increment data to continue syncing
        this._codecParser.incrementRawData(
          yield* this._getNextFrameSyncOffset(1)
        );
      }
    } while (true);
  }

  parseOggPage(oggPage: OggPage) {
    if (oggPage.pageSequenceNumber === 0) {
      // Identification header

      this._headerCache.enable();
      this._streamInfo = oggPage.data.subarray(13);
    } else if (oggPage.pageSequenceNumber === 1) {
      // Vorbis comments
    } else {
      oggPage.codecFrames = (frameStore.get(oggPage) as RawFLACHeader)
        .segments.map((segment) => {
          const header = getHeaderFromUint8Array(
            segment,
            this._headerCache
          );

          if (header) {
            return new FLACFrame(segment, header, this._streamInfo);
          } else {
            this._codecParser.logWarning(
              "Failed to parse Ogg FLAC frame",
              "Skipping invalid FLAC frame"
            );
          }
        })
        .filter((frame) => Boolean(frame));
    }

    return oggPage;
  }
}
