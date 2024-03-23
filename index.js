const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const saltRound = 10;
const app = express();

// Middleware
app.use(express.json());
app.use(cors({
    origin: "https://vlab.taawunakademi.com",
    methods: ["GET", "POST", "PUT"],
    credentials: true,
}));
app.options('*', cors({
    origin: "https://vlab.taawunakademi.com",
    methods: ["GET", "POST", "PUT"],
    credentials: true,
}));
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    key: "userId",
    secret: "subscribe",
    resave: false,
    saveUninitialized: false,
    cookie: {
        expires: 60 * 60 * 24,
    },
}));

const db = mysql.createConnection({
    user: "u243048577_artus",
    host: "srv1157.hstgr.io",
    password: "#R2S.artus!",
    database: "u243048577_artus_vlab",
});

// Reconnect function
function mysql_reconnect(callback) {
    db.connect(function(err) {
        if (err) {
            console.log('Error connecting to MySQL:', err);
            setTimeout(mysql_reconnect(callback), 500);
        } else {
            console.log('Connected to MySQL');
            callback();
        }
    });
}

// Helper Functions
const hashPassword = (password, callback) => {
    bcrypt.hash(password, saltRound, callback);
};

const verifyJWT = (req, res, next) => {
    const token = req.headers["x-access-token"];
    if (!token) {
        res.send("We need a token, please give it to us next time");
    } else {
        jwt.verify(token, "jwtSecret", (err, decoded) => {
            if (err) {
                console.log(err);
                res.json({ auth: false, message: "you are failed to authenticate"});
            } else {
                req.userId = decoded.id;
                next();
            }
        });
    }
};

// Execute query function with reconnection handling
function executeQuery(sql, values, callback) {
    mysql_reconnect(function() {
        db.execute(sql, values, callback);
    });
}

// Routes
app.post('/register', (req, res) => {
    const { email, fullname, password } = req.body;
    hashPassword(password, (err, hash) => {
        if (err) {
            console.log(err);
            res.status(500).send("Kesalahan dalam hashing kata sandi!");
        } else {
            executeQuery(
                "INSERT INTO users (email, fullname, password) VALUES (?,?,?)",
                [email, fullname, hash],
                (err, result) => {
                    if (err) {
                        console.log(err);
                        res.status(500).send("Kesalahan dalam mendaftarkan pengguna!");
                    } else {
                        const id_user = result.insertId;
                        addLearningEntries(id_user);
                        res.status(200).send("Pengguna berhasil mendaftar!");
                    }
                }
            );
        }
    });
});

function addLearningEntries(userId) {
    executeQuery('SELECT id_class FROM classes', (err, classesResult) => {
        if (err) {
            console.log(err);
            return;
        }

        classesResult.forEach(classRow => {
            const classId = classRow.id_class;
            const is_open = classId === 1 ? 1 : 0;
            executeQuery(
                "INSERT INTO learning (id_user, id_class, status, learned, is_open) VALUES (?,?,?,?,?)",
                [userId, classId, 0, 0, is_open],
                (err, result) => {
                    if (err) {
                        console.log(err);
                        return;
                    }
                    console.log(`Berhasil menambahkan kelas "${classId}" untuk user "${userId}"`);
                }
            );
        });
    });
}

app.get('/isUserAuth', verifyJWT, (req, res) => {
    res.send(true)
});

app.get("/login", (req, res) => {
    if (req.session.user) {
      res.send({ loggedIn: true, user: req.session.user });
    } else {
      res.send({ loggedIn: false });
    }
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    executeQuery(
        "SELECT * FROM users WHERE email = ?;",
        [email],
        (err, result) => {
            if (err) {
                res.send({ err: err });
            }
            if (result.length > 0) {
                bcrypt.compare(password, result[0].password, (error, response) => {
                    if (response) {
                        const id_user = result[0].id_user;
                        const token = jwt.sign({ id_user }, "jwtSecret", {
                            expiresIn: 3600,
                        });
                        const user = { id_user: result[0].id_user, email: result[0].email, fullname: result[0].fullname };
                        req.session.user = user;
                        req.session.id_user = id_user;
                        console.log(req.session.user);
                        res.json({ auth: true, token: token, user: user });
                    } else {
                        res.json({ auth: false, message: "Kata sandi pengguna salah!" });
                    }
                });
            } else {
                res.json({ auth: false, message: "Pengguna tidak terdaftar!" });
            }
        }
    );
});

app.get('/myclasses', (req, res) => {
    const id_user = req.query.userId;
    const filter = req.query.filter;
    const sort = req.query.sort;
    const searchName = req.query.searchName;

    if (!id_user) {
        res.status(400).json({
            message: "Parameter user tidak ditemukan",
            statusCode: 400,
            status: "error"
        });
        return;
    }

    let filterQuery = '';

    if (filter !== undefined && filter >= 0 && filter <= 2) {
        filterQuery = ' AND learning.status = ' + filter;
    }

    let orderByClause = '';

    if (sort === "A-Z") {
        orderByClause = ' ORDER BY classes.class_name ASC';
    } else if (sort === "Z-A") {
        orderByClause = ' ORDER BY classes.class_name DESC';
    }

    let searchQuery = '';

    if (searchName) {
        searchQuery = ` AND classes.class_name LIKE '%${searchName}%'`;
    }

    executeQuery('SELECT COUNT(*) as total FROM classes', (err, totalResult) => {
        if (err) {
            console.log(err);
            res.status(500).json({
                message: "Gagal mengambil data kelas dari database",
                statusCode: 500,
                status: "error"
            });
            return;
        }

        const totalClasses = totalResult[0].total;

        executeQuery(`
            SELECT 
                classes.id_class, 
                classes.class_name, 
                classes.is_simulation, 
                classes.is_modul, 
                learning.status, 
                learning.learned, 
                learning.is_open 
            FROM 
                classes 
            LEFT JOIN 
                learning 
            ON 
                classes.id_class = learning.id_class 
            WHERE 
                learning.id_user = ? 
                ${filterQuery} 
                ${searchQuery} 
                ${orderByClause}
        `, [id_user], (err, results) => {
            if (err) {
                console.log(err);
                res.status(500).json({
                    message: "Gagal mengambil data kelas dari database",
                    statusCode: 500,
                    status: "error"
                });
                return;
            }

            if (results.length === 0) {
                res.status(200).json({
                    total: 0,
                    message: "Data kelas tidak ditemukan untuk userId dan filter yang diberikan",
                    statusCode: 404,
                    status: "error"
                });
                return;
            }

            const responseData = {
                total: totalClasses,
                data: results.map(row => {
                    return {
                        classId: row.id_class,
                        class_name: row.class_name,
                        isSimulation: row.is_simulation,
                        isModul: row.is_modul,
                        status: row.status,
                        learned: row.learned,
                        is_open: row.is_open
                    };
                }),
                userId: id_user,
                message: "Sukses mengambil data kelas",
                statusCode: 200,
                status: "success"
            };
            res.status(200).json(responseData);
        });
    });
});

app.put('/updateProgress/:userId', (req, res) => {
    const userId = req.params.userId;

    executeQuery('SELECT * FROM learning WHERE id_user = ?', [userId], (err, learningResults) => {
        if (err) {
            console.log(err);
            res.status(500).json({
                message: "Gagal mengambil data pembelajaran dari database",
                statusCode: 500,
                status: "error"
            });
            return;
        }

        if (learningResults.length === 0) {
            res.status(404).json({
                message: "Data pembelajaran tidak ditemukan untuk pengguna dengan ID yang diberikan",
                statusCode: 404,
                status: "error"
            });
            return;
        }

        let totalData = learningResults.length;
        let ongoing = 0;
        let done = 0;
        learningResults.forEach(learningRow => {
            if (learningRow.status === 1) {
                ongoing += 1;
            } else if (learningRow.status === 2) {
                done += 1;
            }
        });
        progress = ((done + ongoing * 0.5) / totalData) * 100;

        executeQuery('UPDATE users SET progress = ? WHERE id_user = ?', [progress, userId], (err, updateResult) => {
            if (err) {
                console.log(err);
                res.status(500).json({
                    message: "Gagal memperbarui progress pengguna di database",
                    statusCode: 500,
                    status: "error"
                });
                return;
            }
            res.status(200).json({
                progress: progress,
                message: "Progress pengguna berhasil diperbarui",
                statusCode: 200,
                status: "success"
            });
        });
    });
});

app.get('/status/:userId/:classId', (req, res) => {
    const userId = req.params.userId;
    const classId = req.params.classId;

    if (!userId || !classId) {
        res.status(400).json({
            message: "Parameter userId atau classId tidak ditemukan",
            statusCode: 400,
            status: "error"
        });
        return;
    }

    executeQuery('SELECT status FROM learning WHERE id_user = ? AND id_class = ?', [userId, classId], (err, results) => {
        if (err) {
            console.log(err);
            res.status(500).json({
                message: "Gagal mengambil status pembelajaran dari database",
                statusCode: 500,
                status: "error"
            });
            return;
        }

        if (results.length === 0) {
            res.status(404).json({
                message: "Data pembelajaran tidak ditemukan untuk userId dan classId yang diberikan",
                statusCode: 404,
                status: "error"
            });
            return;
        }

        const { status } = results[0];

        res.status(200).json({
            statusClass: status,
            message: "Sukses mengambil status pembelajaran",
            statusCode: 200,
            status: "success"
        });
    });
});

app.put('/updateStatus/:userId/:classId', (req, res) => {
    const userId = req.params.userId;
    const classId = req.params.classId;
    const newStatus = req.body.status;

    if (newStatus !== 0 && newStatus !== 1 && newStatus !== 2) {
        res.status(400).json({
            message: "Status pembelajaran tidak valid",
            statusCode: 400,
            status: "error"
        });
        return;
    }

    executeQuery('SELECT status FROM learning WHERE id_user = ? AND id_class = ?', [userId, classId], (err, result) => {
        if (err) {
            console.log(err);
            res.status(500).json({
                message: "Gagal memeriksa status pembelajaran di database",
                statusCode: 500,
                status: "error"
            });
            return;
        }

        if (result.length === 0) {
            res.status(404).json({
                message: "Data pembelajaran tidak ditemukan untuk pengguna dengan ID dan kelas yang diberikan",
                statusCode: 404,
                status: "error"
            });
            return;
        }

        const currentStatus = result[0].status;

        if (currentStatus === 2) {
            res.status(200).json({
                message: "Pembelajaran ini untuk user ini sudah selesai",
                statusCode: 200,
                status: "success"
            });
            return;
        }

        executeQuery('UPDATE learning SET status = ?, is_open = ? WHERE id_user = ? AND id_class = ?', [newStatus, 1, userId, classId], (err, updateResult) => {

            if (err) {
                console.log(err);
                res.status(500).json({
                    message: "Gagal memperbarui status pembelajaran di database",
                    statusCode: 500,
                    status: "error"
                });
                return;
            }

            executeQuery('SELECT learned FROM learning WHERE id_user = ? AND id_class = ?', [userId, classId], (err, learnedResult) => {
                if (err) {
                    console.log(err);
                    res.status(500).json({
                        message: "Gagal mendapatkan nilai learned dari database",
                        statusCode: 500,
                        status: "error"
                    });
                    return;
                }

                const learned = learnedResult.length > 0 ? learnedResult[0].learned : null;

                res.status(200).json({
                    message: "Status pembelajaran berhasil diperbarui",
                    statusCode: 200,
                    status: "success",
                    learned: learned
                });
            });
        });
    });
});

app.get('/learning/:userId/:classId', (req, res) => {
    const userId = req.params.userId;
    const classId = req.params.classId;

    if (!userId || !classId) {
        res.status(400).json({
            message: "Parameter userId atau classId tidak ditemukan",
            statusCode: 400,
            status: "error"
        });
        return;
    }

    executeQuery('SELECT * FROM learning WHERE id_user = ? AND id_class = ?', [userId, classId], (err, results) => {
        if (err) {
            console.log(err);
            res.status(500).json({
                message: "Gagal mengambil data pembelajaran dari database",
                statusCode: 500,
                status: "error"
            });
            return;
        }

        if (results.length === 0) {
            res.status(404).json({
                message: "Data pembelajaran tidak ditemukan untuk userId dan classId yang diberikan",
                statusCode: 404,
                status: "error"
            });
            return;
        }

        res.status(200).json({
            data: results,
            message: "Sukses mengambil data pembelajaran",
            statusCode: 200,
            status: "success"
        });
    });
});

app.put('/updateLearned/:userId/:classId', (req, res) => {
    const userId = req.params.userId;
    const classId = req.params.classId;
    const newLearnedValue = req.body.learned;

    if (newLearnedValue === undefined || newLearnedValue < 0 || newLearnedValue > 100) {
        res.status(400).json({
            message: "Nilai learned tidak valid",
            statusCode: 400,
            status: "error"
        });
        return;
    }

    executeQuery('SELECT status FROM learning WHERE id_user = ? AND id_class = ?', [userId, classId], (err, result) => {
        if (err) {
            console.log(err);
            res.status(500).json({
                message: "Gagal memeriksa status pembelajaran di database",
                statusCode: 500,
                status: "error"
            });
            return;
        }

        if (result.length === 0) {
            res.status(404).json({
                message: "Data pembelajaran tidak ditemukan untuk pengguna dengan ID dan kelas yang diberikan",
                statusCode: 404,
                status: "error"
            });
            return;
        }

        const currentStatus = result[0].status;

        if (currentStatus === 2) {
            res.status(400).json({
                message: "Pembelajaran ini sudah selesai.",
                statusCode: 400,
                status: "error"
            });
            return;
        }

        executeQuery('UPDATE learning SET learned = ? WHERE id_user = ? AND id_class = ?', [newLearnedValue, userId, classId], (err, updateResult) => {
            if (err) {
                console.log(err);
                res.status(500).json({
                    message: "Gagal memperbarui nilai learned di database",
                    statusCode: 500,
                    status: "error"
                });
                return;
            }

            res.status(200).json({
                message: "Nilai learned berhasil diperbarui",
                statusCode: 200,
                status: "success",
                learned: newLearnedValue
            });
        });
    });
});

app.get('/reflection/:userId/:classId', (req, res) => {
    const userId = req.params.userId;
    const classId = req.params.classId;

    if (!userId || !classId) {
        res.status(400).json({
            message: "Parameter userId atau classId tidak ditemukan",
            statusCode: 400,
            status: "error"
        });
        return;
    }

    executeQuery('SELECT reflection FROM learning WHERE id_user = ? AND id_class = ?', [userId, classId], (err, results) => {
        if (err) {
            console.log(err);
            res.status(500).json({
                message: "Gagal mengambil data refleksi dari database",
                statusCode: 500,
                status: "error"
            });
            return;
        }

        if (results.length === 0) {
            res.status(404).json({
                message: "Data refleksi tidak ditemukan untuk userId dan classId yang diberikan",
                statusCode: 404,
                status: "error"
            });
            return;
        }

        res.status(200).json({
            reflection: results[0].reflection,
            message: "Sukses mengambil data refleksi",
            statusCode: 200,
            status: "success"
        });
    });
});

app.put('/reflection/:userId/:classId', (req, res) => {
    const userId = req.params.userId;
    const classId = req.params.classId;
    const newReflection = req.body.reflection;

    if (!userId || !classId || newReflection === undefined) {
        res.status(400).json({
            message: "Parameter userId, classId, atau reflection tidak ditemukan",
            statusCode: 400,
            status: "error"
        });
        return;
    }

    executeQuery('UPDATE learning SET reflection = ? WHERE id_user = ? AND id_class = ?', [newReflection, userId, classId], (err, updateResult) => {
        if (err) {
            console.log(err);
            res.status(500).json({
                message: "Gagal memperbarui refleksi di database",
                statusCode: 500,
                status: "error"
            });
            return;
        }

        res.status(200).json({
            message: "Refleksi berhasil diperbarui",
            statusCode: 200,
            status: "success"
        });
    });
});

app.listen(3001, () => {
    console.log("running server");
});