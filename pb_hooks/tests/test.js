// Helper used by GET /api/board/stats (messages.pb.js), to try Step Into.
// Not a *.pb.js file, so PocketBase only runs it through require().
function helloWorld(totals) {
    const greeting = "Hello, World!";
    console.log(greeting);

    const average = totals.messages ? totals.likes / totals.messages : 0;
    return { greeting: greeting, averageLikes: Math.round(average * 100) / 100 };
}

module.exports = { helloWorld };
