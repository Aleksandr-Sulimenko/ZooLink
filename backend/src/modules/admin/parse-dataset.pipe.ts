import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import { DATASETS, type Dataset } from './dto/reference-data.dto';

/**
 * Validates the `{dataset}` path segment against the managed lookup datasets (admin-api.yaml enum,
 * round-9). An unknown dataset → 400 (problem+json), matching the contract's "400 invalid dataset".
 */
@Injectable()
export class ParseDatasetPipe implements PipeTransform<string, Dataset> {
  transform(value: string): Dataset {
    if ((DATASETS as readonly string[]).includes(value)) {
      return value as Dataset;
    }
    throw new BadRequestException({
      message: `Unknown reference dataset '${value}'. Managed: ${DATASETS.join(', ')}`,
      code: 'VALIDATION_ERROR',
    });
  }
}
