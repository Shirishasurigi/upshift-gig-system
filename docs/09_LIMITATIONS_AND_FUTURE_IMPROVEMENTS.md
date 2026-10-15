# Limitations and Future Improvements

## 1. Introduction

UpShift Gig System is an AI-assisted gig discovery, verification, review, and publishing system. It automates parts of the opportunity discovery process while retaining human control over final publishing decisions.

This document describes the known limitations of the current version and potential improvements for future development.

## 2. Current Limitations

### 2.1 External Source Availability

- Gig discovery depends on the availability and accessibility of supported external sources.
- External websites may change their page structure, URLs, or access policies, which can affect extraction.
- Restricted content and sources requiring unauthorized access cannot be reliably processed by the system.
- Source adapters may require maintenance when external services change their interfaces.

### 2.2 AI Classification and Verification

- AI-generated classifications and verification assessments may occasionally be incorrect or incomplete.
- Classification confidence and verification evidence should be reviewed when information is ambiguous.
- External page availability alone does not guarantee that an opportunity is genuine, open, or accepting applications.
- Human review remains important for uncertain cases and final publishing decisions.

### 2.3 Data Quality and Deduplication

- Missing or inconsistent information from source websites can affect the completeness of gig records.
- Similarity-based duplicate detection may flag legitimate opportunities for review.
- Opportunities with substantial changes may require human inspection to determine whether they represent updates or separate listings.

### 2.4 External Service Dependencies

- AI-assisted operations depend on the configuration and availability of the selected AI provider.
- External service failures, network problems, or rate limits can delay discovery and verification.
- Production deployment requires appropriate configuration, monitoring, and management of external service credentials.

### 2.5 Testing and Validation

- The current project has automated backoffice tests, and the main application workflows have been exercised during local testing.
- The backoffice test suite passed 33 tests during the recorded validation.
- This does not establish complete automated coverage of every API endpoint, database failure scenario, external source, or end-to-end workflow.
- Additional automated integration and regression testing would improve confidence before production deployment.

### 2.6 Deployment and Operations

- The local development environment requires the API, backoffice, website, and MySQL database to be configured and available.
- A production deployment would require appropriate hosting, secure environment configuration, monitoring, backup procedures, and operational support.
- Performance and scalability under substantial concurrent workloads have not been established by the local functional checks.

## 3. Future Improvements

### 3.1 Expand Source Integrations

- Add more permitted and reliable gig sources.
- Improve source health monitoring and failure reporting.
- Add automated tests for source-specific extraction and normalization.
- Improve resilience when external page layouts change.

### 3.2 Improve AI-Assisted Processing

- Evaluate classification accuracy using a larger labelled dataset.
- Improve confidence calibration and handling of uncertain predictions.
- Expand verification evidence and explanations to help reviewers make informed decisions.
- Monitor incorrect classifications and verification outcomes to guide future improvements.

### 3.3 Strengthen Data Quality

- Improve duplicate detection using additional comparison signals.
- Provide clearer handling of incomplete, conflicting, or outdated opportunity information.
- Expand validation and regression tests for CSV import and export.
- Improve reporting of rejected rows and data-quality issues.

### 3.4 Expand Automated Testing

- Add broader API unit and integration tests.
- Automate end-to-end tests for discovery, verification, review, publishing, and CSV workflows.
- Add tests for authorization, invalid inputs, source failures, and publication eligibility.
- Include automated checks to prevent accidental exposure of environment files and credentials.

### 3.5 Improve Monitoring and Reliability

- Add operational dashboards for discovery runs, verification outcomes, failures, and processing duration.
- Improve retry handling and visibility into failed background jobs.
- Establish database backup and recovery procedures.
- Evaluate worker scalability and job-processing reliability as workload increases.

### 3.6 Enhance the User Experience

- Improve filtering, searching, and sorting in the backoffice.
- Provide clearer feedback for long-running operations and failed requests.
- Improve reviewer productivity through better evidence presentation and workflow summaries.
- Enhance public opportunity browsing and accessibility.

## 4. Conclusion

The current version demonstrates the core architecture and workflows for gig discovery, AI-assisted classification and verification, human review, publishing, and CSV handling.

The improvements listed above are potential future enhancements. They are not claims that these features are already implemented or fully validated. Human oversight, evidence-based verification, secure configuration, and additional automated testing remain important as the system evolves.