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

import { CodecParser } from "../CodecParser";
import Frame from "../containers/Frame";
import { frameStore } from "../globals";
import { FrameHeaderOf, GetFrame, GetHeader } from "../types";
import HeaderCache from "./HeaderCache";

/**
 * @abstract
 * @description Abstract class containing methods for parsing codec frames
 */
export default class Parser<F extends Frame<any>, H = FrameHeaderOf<F>> {  
  protected _codecParser: CodecParser;
  protected _headerCache: HeaderCache;

  constructor(codecParser: CodecParser, headerCache: HeaderCache, private getFrame?: GetFrame<F>, private getHeader?: GetHeader<H>) {
    this._codecParser = codecParser;
    this._headerCache = headerCache;
  }

  get codec() {
    return "";
  }

  *parseFrame(): Generator<Uint8Array | undefined, F | null> {
    return null;
  }

  *syncFrame() {
    let frame: F | null;

    do {
      frame = yield* this.getFrame!(
        this._codecParser,
        this._headerCache,
        0
      );
      
      if (frame) {
        return frame;
      }
      
      this._codecParser.incrementRawData(1); // increment to continue syncing
    } while (true);
  }

  /**
   * @description Searches for Frames within bytes containing a sequence of known codec frames.
   * @param {boolean} ignoreNextFrame Set to true to return frames even if the next frame may not exist at the expected location
   * @returns {F}
   */
  *fixedLengthFrameSync(ignoreNextFrame?: boolean): Generator<Uint8Array | undefined, F | null> {
    let frame = yield* this.syncFrame();
    const frameLength = frameStore.get(frame).length;

    if (ignoreNextFrame || this._codecParser.isFlushing ||
      // check if there is a frame right after this one
      (yield* this.getHeader!(
        this._codecParser,
        this._headerCache,
        frameLength
      ))
    ) {
      this._headerCache.enable(); // start caching when synced

      this._codecParser.incrementRawData(frameLength); // increment to the next frame
      this._codecParser.mapFrameStats(frame);
      return frame;
    }

    this._codecParser.logWarning(
      `Missing frame frame at ${frameLength} bytes from current position.`,
      "Dropping current frame and trying again."
    );
    this._headerCache.reset(); // frame is invalid and must re-sync and clear cache
    this._codecParser.incrementRawData(1); // increment to invalidate the current frame

    return null;
  }  
}
