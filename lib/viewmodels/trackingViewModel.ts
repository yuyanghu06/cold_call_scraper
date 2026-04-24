export interface TrackingCompany {
  id: string;
  name: string | null;
  territory: string[];
  callStatus: string | null;
  industry: string | null;
  address: string | null;
  ownerName: string | null;
  companyNumber: string | null;
  followUpNumber: string | null;
  notes: string | null;
}

export interface TrackingUpdate {
  name?: string | null;
  territory?: string[];
  callStatus?: string | null;
  industry?: string | null;
  address?: string | null;
  ownerName?: string | null;
  companyNumber?: string | null;
  followUpNumber?: string | null;
  notes?: string | null;
}

export interface ListCompaniesParams {
  territory?: string[] | null;
  callStatus?: string[] | null;
  industry?: string[] | null;
  limit?: number;
  offset?: number;
}

export interface ListCompaniesResult {
  companies: TrackingCompany[];
  nextOffset: number | null;
}
