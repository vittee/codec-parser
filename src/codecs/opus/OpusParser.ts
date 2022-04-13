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
import { frameStore } from "../../globals";
import HeaderCache from "../HeaderCache";
import Parser from "../Parser";
import OpusFrame from "./OpusFrame";
import OpusHeader from "./OpusHeader";

export default class OpusParser extends Parser {
  constructor(codecParser: CodecParser, headerCache: HeaderCache) {
    super(codecParser, headerCache);

    this._identificationHeader = null;
  }

  get codec() {
    return "opus";
  }

  /**
   * @todo implement continued page support
   */
  parseOggPage(oggPage) {
    if (oggPage.pageSequenceNumber === 0) {
      // Identification header

      this._headerCache.enable();
      this._identificationHeader = oggPage.data;
    } else if (oggPage.pageSequenceNumber === 1) {
      // OpusTags
    } else {
      oggPage.codecFrames = frameStore.get(oggPage).segments.map((segment) => {
        const header = OpusHeader.getHeaderFromUint8Array( // TODO: Use function
          this._identificationHeader,
          segment,
          this._headerCache
        );

        if (header) return new OpusFrame(segment, header);

        this._codecParser.logError(
          "Failed to parse Ogg Opus Header",
          "Not a valid Ogg Opus file"
        );
      });
    }

    return oggPage;
  }
}
