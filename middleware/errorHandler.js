// middleware/errorHandler.js

function errorHandler(err, req, res, next) {
    console.error(err.stack);
    res.status(500).send({
        status: 'error',
        message: err.message,
    });
}

module.exports = errorHandler;