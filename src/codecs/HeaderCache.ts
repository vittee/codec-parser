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

import { OnCodecUpdate } from "../types";
import { RawCodecHeader } from "./CodecHeader";

export class HeaderCache {
  private isEnabled = false;
  private headerCache!: Map<any, any>;
  private codecUpdateData!: WeakMap<object, any>;
  private codecShouldUpdate = false;
  private currentHeader!: string;
  private bitrate = 0;

  constructor(private onCodecUpdate?: OnCodecUpdate) {
    this.reset();
  }

  enable() {
    this.isEnabled = true;
  }

  reset() {
    this.headerCache = new Map();
    this.codecUpdateData = new WeakMap();
    this.codecShouldUpdate = false;
    this.bitrate = 0;
    this.isEnabled = false;
  }

  checkCodecUpdate(bitrate: number, totalDuration: number) {
    if (this.onCodecUpdate) {
      if (this.bitrate !== bitrate) {
        this.bitrate = bitrate;
        this.codecShouldUpdate = true;
      }

      if (this.codecShouldUpdate) {
        this.onCodecUpdate(
          {
            bitrate,
            ...this.codecUpdateData.get(
              this.headerCache.get(this.currentHeader)
            ),
          },
          totalDuration
        );
      }

      this.codecShouldUpdate = false;
    }
  }

  updateCurrentHeader(key: string) {
    if (this.onCodecUpdate && key !== this.currentHeader) {
      this.codecShouldUpdate = true;
      this.currentHeader = key;
    }
  }

  getHeader(key: string) {
    const header = this.headerCache.get(key);

    if (header) {
      this.updateCurrentHeader(key);
    }

    return header;
  }

  setHeader(key: string, header: RawCodecHeader, codecUpdateFields: any) {
    if (this.isEnabled) {
      this.updateCurrentHeader(key);

      this.headerCache.set(key, header);
      this.codecUpdateData.set(header, codecUpdateFields);
    }
  }
}
