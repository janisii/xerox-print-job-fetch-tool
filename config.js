const restEndpoints = {
  lastJobId:
    "https://<local_system>/api/<key>/copy-print-job/last-jobid", // endpoint to get the last pushed job to database
  addJob:
    "https://<local_system>/api/<key>/copy-print-job/add",  // endpoint to push data to database
};

module.exports = { restEndpoints };
