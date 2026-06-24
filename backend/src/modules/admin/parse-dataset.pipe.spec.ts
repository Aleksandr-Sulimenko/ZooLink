import { BadRequestException } from '@nestjs/common';
import { ParseDatasetPipe } from './parse-dataset.pipe';

describe('ParseDatasetPipe', () => {
  const pipe = new ParseDatasetPipe();

  it.each(['species', 'breeds', 'cities'])('accepts managed dataset %s', (d) => {
    expect(pipe.transform(d)).toBe(d);
  });

  it.each(['traits', 'listing-types', 'animal-statuses', 'genetic-markers', 'foo'])(
    'rejects non-managed dataset %s with 400',
    (d) => {
      expect(() => pipe.transform(d)).toThrow(BadRequestException);
    },
  );
});
