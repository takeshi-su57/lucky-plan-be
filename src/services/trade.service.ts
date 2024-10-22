import { Injectable } from '@nestjs/common';

import { ClientService } from './client.service';

@Injectable()
export class TradeService {
  constructor(private clientService: ClientService) {}
}
