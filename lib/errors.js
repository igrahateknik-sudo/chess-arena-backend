class CustomError extends Error {
    constructor(message) {
        super(message);
        this.name = this.constructor.name;
    }
}

class NotFoundError extends CustomError {
    constructor(message = 'Resource not found') {
        super(message);
    }
}

class ValidationError extends CustomError {
    constructor(message = 'Validation failed') {
        super(message);
    }
}

class DatabaseError extends CustomError {
    constructor(message = 'Database error occurred') {
        super(message);
    }
}

module.exports = { CustomError, NotFoundError, ValidationError, DatabaseError };