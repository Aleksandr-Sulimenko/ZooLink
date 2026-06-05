---
name: api-contract-listing-type-mismatch
description: Mismatch between listing types in listings-api and matching-api regarding stud_service
metadata:
  type: project
---

In listings-api.yaml, the listing_type enum includes [sale, breeding, show, adoption] (lines 369-372, 447-450, 491-494). However, in matching-api.yaml, the ListingReference schema includes listing_type enum with [sale, breeding, show, adoption, stud_service] (line 645), and MatchDetails references targetListings and candidateListings arrays of ListingReference, implying that stud_service listings exist.

**Why:** This inconsistency could cause integration issues where matching service expects stud_service listings but listings API does not support creating or retrieving them, leading to 404 errors or validation failures.

**How to apply:** Either add stud_service to the listing_type enum in listings-api.yaml (and ensure corresponding database support) or remove stud_service from matching-api enums and references if stud_service is not intended to be a listing type. Align the definitions across contracts.