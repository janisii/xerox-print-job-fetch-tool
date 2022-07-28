const fetch = require("node-fetch");
const { restEndpoints } = require("./config");

/**
 * Get last jobId found in server
 * @param {*} deviceName
 */
const fetchLastJobId = deviceName =>
  new Promise(async resolve => {
    const postData = {
      device_name: deviceName,
    };

    const res = await fetch(restEndpoints.lastJobId, {
      method: "POST", // *GET, POST, PUT, DELETE, etc.
      mode: "cors", // no-cors, *cors, same-origin
      cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
      credentials: "same-origin", // include, *same-origin, omit
      headers: {
        "Content-Type": "application/json",
      },
      redirect: "follow", // manual, *follow, error
      referrerPolicy: "no-referrer", // no-referrer, *client
      body: JSON.stringify(postData), // body data type must match "Content-Type" header
    });

    const data = await res.json();
    return resolve(data.jobId);
  });

/**
 * Push all jobs to server
 * @param {*} jobs
 */
const pushJobsToServer = jobs =>
  new Promise(async resolve => {
    // Jobs sorting by timestamp
    jobs.sort((a, b) => a.jobTimestamp - b.jobTimestamp);

    for (const job of jobs) {
      const postData = {
        device_name: job.device,
        job_type: job.jobType,
        job_id: job.jobId,
        job_pages: job.jobTotalPages,
        job_completed_at: job.jobTimeCompleted,
        user_name: job.jobUser,
      };

      const res = await fetch(restEndpoints.addJob, {
        method: "POST", // *GET, POST, PUT, DELETE, etc.
        mode: "cors", // no-cors, *cors, same-origin
        cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
        credentials: "same-origin", // include, *same-origin, omit
        headers: {
          "Content-Type": "application/json",
        },
        redirect: "follow", // manual, *follow, error
        referrerPolicy: "no-referrer", // no-referrer, *client
        body: JSON.stringify(postData), // body data type must match "Content-Type" header
      });

      const data = await res.json();
      console.log(data);
    }

    return resolve("Completed.");
  });

module.exports = { fetchLastJobId, pushJobsToServer };
