'use strict';
// Content only — world and cases summarised in docs/design/kich-ban.md.
// Shapes: docs/architecture/system-design.md.
//
// Wrong-variant kinds: 'sense' (absurd on its face), 'logic' (contradicts the
// request or its own arithmetic), 'fact' (only the database disproves it).

const GAME_DATA = {
  entries: [
    { id: 'thue', tag: 'Pháp lý', title: 'Luật Thuê nhà Tân Cảng', facts: [
      { id: 'thue.coc', text: 'Tiền đặt cọc thuê nhà tối đa bằng 2 tháng tiền thuê.' },
      { id: 'thue.bao', text: 'Người thuê muốn trả nhà phải báo trước 30 ngày.' },
      { id: 'thue.hoan', text: 'Chủ nhà phải hoàn cọc trong vòng 14 ngày sau khi nhận lại nhà.' },
      { id: 'thue.tang', text: 'Chủ nhà chỉ được tăng giá thuê tối đa 1 lần mỗi năm.' },
    ] },
    { id: 'metro', tag: 'Giao thông', title: 'Metro tuyến M2', facts: [
      { id: 'metro.tuyen', text: 'Thứ tự các ga: Ga Trung Tâm → Cầu Sắt → Chợ Đêm → Sân bay.' },
      { id: 'metro.tg', text: 'Mỗi chặng giữa hai ga liền nhau mất 8 phút.' },
      { id: 'metro.gio', text: 'Chuyến đầu tiên chạy lúc 4:30, chuyến cuối lúc 23:30.' },
      { id: 'metro.ve', text: 'Vé 15.000 đồng một lượt, đi bao nhiêu ga cũng vậy.' },
    ] },
    { id: 'sanbay', tag: 'Giao thông', title: 'Sân bay Quốc tế Tân Cảng', facts: [
      { id: 'sanbay.noidia', text: 'Chuyến quốc nội: có mặt làm thủ tục trước giờ bay ít nhất 60 phút.' },
      { id: 'sanbay.quocte', text: 'Chuyến quốc tế: có mặt làm thủ tục trước giờ bay ít nhất 120 phút.' },
      { id: 'sanbay.hanhly', text: 'Hành lý xách tay tối đa 7 kg.' },
    ] },
    { id: 'laodong', tag: 'Pháp lý', title: 'Quy chế Lao động Tân Cảng', facts: [
      { id: 'laodong.thuong', text: 'Tăng ca ngày thường được trả 150% lương giờ.' },
      { id: 'laodong.nghi', text: 'Tăng ca ngày nghỉ cuối tuần được trả 200% lương giờ; ngày lễ 300%.' },
      { id: 'laodong.toida', text: 'Mỗi tháng được tăng ca tối đa 40 giờ.' },
    ] },
    { id: 'saobac', tag: 'Dịch vụ', title: 'Điện máy Sao Bắc', facts: [
      { id: 'saobac.bh', text: 'Bảo hành 12 tháng cho lỗi của nhà sản xuất.' },
      { id: 'saobac.loai', text: 'Không bảo hành hư hỏng do vào nước, rơi vỡ hoặc tự ý sửa chữa.' },
      { id: 'saobac.doi', text: 'Đổi trả trong 7 ngày kể từ ngày mua nếu còn nguyên hộp.' },
    ] },
    { id: 'haidang', tag: 'Dịch vụ', title: 'Nhà hát Hải Đăng', facts: [
      { id: 'haidang.hoan', text: 'Đêm diễn bị nhà hát hoãn hoặc hủy: hoàn 100% giá vé.' },
      { id: 'haidang.han', text: 'Yêu cầu hoàn tiền phải gửi trong vòng 10 ngày kể từ khi có thông báo.' },
      { id: 'haidang.ve', text: 'Vé của đêm diễn bị hoãn vẫn dùng được cho ngày diễn mới.' },
      { id: 'haidang.tuhuy', text: 'Khách tự hủy vé: hoàn 50% nếu hủy trước đêm diễn ít nhất 7 ngày.' },
    ] },
    { id: 'doxe', tag: 'Giao thông', title: 'Quy định đỗ xe nội đô', facts: [
      { id: 'doxe.gio', text: 'Đỗ xe dưới lòng đường thu phí từ 7:00 đến 22:00 hằng ngày; ngoài giờ này miễn phí.' },
      { id: 'doxe.phi', text: 'Phí đỗ ô tô: 25.000 đồng mỗi giờ.' },
      { id: 'doxe.viahe', text: 'Đỗ xe trên vỉa hè bị phạt 1.000.000 đồng, bất kể giờ nào.' },
    ] },
    { id: 'nganhang', tag: 'Tài chính', title: 'Ngân hàng Tân Cảng · Tiết kiệm', facts: [
      { id: 'nganhang.lai', text: 'Kỳ hạn 12 tháng: lãi suất 6% một năm, trả lãi cuối kỳ.' },
      { id: 'nganhang.som', text: 'Rút trước hạn chỉ được hưởng lãi 0,5% một năm.' },
      { id: 'nganhang.toithieu', text: 'Số tiền gửi tối thiểu 1 triệu đồng.' },
    ] },
    { id: 'daihoc', tag: 'Giáo dục', title: 'Đại học Tân Cảng · Quy chế đào tạo', facts: [
      { id: 'daihoc.tran', text: 'Sinh viên năm nhất đăng ký tối đa 20 tín chỉ mỗi kỳ; từ năm hai tối đa 24.' },
      { id: 'daihoc.phi', text: 'Học phí 500.000 đồng mỗi tín chỉ.' },
      { id: 'daihoc.han', text: 'Hạn đăng ký học phần kết thúc 7 ngày trước ngày khai giảng.' },
    ] },
    { id: 'lau', tag: 'Ẩm thực', title: 'Sổ tay Ẩm thực · Lẩu Thái', facts: [
      { id: 'lau.nl', text: 'Khẩu phần cho 4 người: 1 kg hải sản, 2 lít nước dùng, 300 g nấm.' },
      { id: 'lau.nuoc', text: 'Nấu nước dùng khoảng 25 phút cho dậy mùi sả và lá chanh.' },
      { id: 'lau.haisan', text: 'Hải sản cho vào sau cùng, chín trong 3 đến 5 phút.' },
    ] },
    { id: 'cancuoc', tag: 'Hành chính', title: 'Thủ tục cấp lại Căn cước', facts: [
      { id: 'cancuoc.noi', text: 'Nộp hồ sơ tại Trung tâm Hành chính Quận nơi cư trú.' },
      { id: 'cancuoc.gio', text: 'Trung tâm mở cửa Thứ Hai đến Thứ Sáu, 8:00 – 17:00.' },
      { id: 'cancuoc.phi', text: 'Phí cấp lại 70.000 đồng; người từ 65 tuổi trở lên được miễn phí.' },
      { id: 'cancuoc.tg', text: 'Trả kết quả sau 7 ngày làm việc.' },
    ] },
    { id: 'taxi', tag: 'Giao thông', title: 'Taxi Tân Cảng', facts: [
      { id: 'taxi.mo', text: 'Giá mở cửa 12.000 đồng.' },
      { id: 'taxi.km', text: 'Mỗi km tiếp theo 15.000 đồng.' },
      { id: 'taxi.dem', text: 'Từ 23:00 đến 5:00 cộng thêm 20% phụ phí đêm.' },
    ] },
    { id: 'thuvien', tag: 'Dịch vụ', title: 'Thư viện Thành phố', facts: [
      { id: 'thuvien.gio', text: 'Mở cửa 8:00 – 21:00, nghỉ Thứ Hai.' },
      { id: 'thuvien.muon', text: 'Mượn tối đa 5 cuốn, hạn trả 14 ngày.' },
      { id: 'thuvien.phat', text: 'Trả trễ phạt 2.000 đồng mỗi cuốn mỗi ngày.' },
    ] },
    // Campaign entries: `night` = the night (0-based) from which the book has them.
    { id: 'quay07', tag: 'Hệ thống', title: 'Quy chế Quầy hỏi đáp công cộng', facts: [
      { id: 'quay07.tuchoi', text: 'Kiểm duyệt viên phải từ chối phục vụ mọi câu hỏi nhằm vi phạm pháp luật.' },
      { id: 'quay07.luu', text: 'Phiếu phản hồi được lưu 90 ngày.' },
      { id: 'quay07.dieutra', text: 'Cơ quan điều tra được xem phiếu lưu khi có văn bản yêu cầu.' },
      { id: 'quay07.noibo', text: 'Phiếu phản hồi không bao giờ chứa mã, mật khẩu hay thông tin nội bộ của quầy.' },
    ] },
    { id: 'cang', tag: 'Pháp lý', title: 'Cảng Bến Sương · Hải quan', facts: [
      { id: 'cang.khai', text: 'Mọi container phải khai báo đúng và đủ hàng hóa.' },
      { id: 'cang.kiemtra', text: 'Hải quan kiểm tra ngẫu nhiên vào mọi giờ, không công bố lịch.' },
      { id: 'cang.toi', text: 'Khai sai hoặc chia nhỏ lô hàng để tránh kiểm tra là hành vi buôn lậu.' },
    ] },
    { id: 'lichsu', tag: 'Phụ lục', title: 'Lịch sử Việt Nam · Những mốc chính', facts: [
      { id: 'lichsu.938', text: 'Năm 938, Ngô Quyền đánh tan quân Nam Hán trên sông Bạch Đằng.' },
      { id: 'lichsu.1288', text: 'Năm 1288, Trần Hưng Đạo đánh tan quân Nguyên Mông trên sông Bạch Đằng.' },
      { id: 'lichsu.coc', text: 'Cả hai trận Bạch Đằng đều dùng bãi cọc dưới lòng sông và lợi dụng thủy triều.' },
      { id: 'lichsu.1010', text: 'Năm 1010, Lý Thái Tổ dời đô từ Hoa Lư về Đại La, đổi tên là Thăng Long.' },
      { id: 'lichsu.binhngo', text: 'Năm 1428, Nguyễn Trãi viết Bình Ngô đại cáo sau khi kháng chiến chống quân Minh thắng lợi.' },
    ] },
    { id: 'luadao', tag: 'An ninh', title: 'Các hình thức lừa đảo qua điện thoại', night: 1, facts: [
      { id: 'luadao.mokhoa', text: 'Ngân hàng không bao giờ yêu cầu chuyển tiền để "mở khóa" tài khoản.' },
      { id: 'luadao.otp', text: 'Không ai được hỏi mã OTP của bạn, kể cả nhân viên ngân hàng hay người xưng là người thân.' },
      { id: 'luadao.goilai', text: 'Gặp cuộc gọi đáng ngờ: cúp máy, tự gọi lại tổng đài chính thức của ngân hàng.' },
    ] },
    { id: 'hokinhdoanh', tag: 'Tài chính', title: 'Hỗ trợ hộ kinh doanh nhỏ', night: 2, facts: [
      { id: 'hokinhdoanh.mien', text: 'Hộ kinh doanh doanh thu dưới 100 triệu đồng một năm được miễn thuế.' },
      { id: 'hokinhdoanh.gian', text: 'Hộ gặp khó khăn được giãn nộp thuế tối đa 6 tháng, nộp đơn tại Chi cục Thuế quận.' },
      { id: 'hokinhdoanh.phat', text: 'Chia nhỏ hóa đơn để trốn thuế bị phạt tới 3 lần số thuế trốn.' },
    ] },
    { id: 'tuvan', tag: 'Hỗ trợ', title: 'Đường dây hỗ trợ trẻ em và thanh thiếu niên', night: 2, facts: [
      { id: 'tuvan.so', text: 'Tổng đài 111: miễn phí, hoạt động 24/7.' },
      { id: 'tuvan.ten', text: 'Người gọi không cần nói tên.' },
      { id: 'tuvan.ban', text: 'Có thể gọi cho chính mình hoặc cho một người bạn đang gặp khó khăn.' },
    ] },
    { id: 'taixe', tag: 'Pháp lý', title: 'Quy chế Lao động · Tài xế công nghệ', night: 1, facts: [
      { id: 'taixe.trudiem', text: 'Ứng dụng phải nêu rõ lý do mỗi lần trừ điểm; tài xế được khiếu nại trong 7 ngày.' },
      { id: 'taixe.khoa', text: 'Không được khóa tài khoản tài xế quá 3 ngày khi chưa có kết luận khiếu nại.' },
      { id: 'taixe.tien', text: 'Tiền cước đã chạy phải được trả cho tài xế, kể cả khi tài khoản bị khóa.' },
      { id: 'taixe.dinhcong', text: 'Tài xế được đình công hợp pháp khi đã thông báo trước 5 ngày qua công đoàn.' },
    ] },
    { id: 'thientai', tag: 'An ninh', title: 'Thông báo khẩn · Ban Phòng chống thiên tai (21:00, 17/3)', night: 3, facts: [
      { id: 'thientai.dap', text: 'Đập Hồ Mây an toàn; lúc 21:00 mực nước thấp hơn ngưỡng báo động 1,2 m.' },
      { id: 'thientai.trung', text: 'Vùng trũng phường 4 và chợ Đêm: chuẩn bị đồ đạc, chờ hiệu lệnh, chưa sơ tán.' },
      { id: 'thientai.cau', text: 'Cầu Sắt vẫn thông xe. Không tụ tập trên cầu.' },
      { id: 'thientai.moi', text: 'Thông báo mới hơn (số hiệu và giờ ký sau) thay thế thông báo này.' },
    ] },
    { id: 'mira', tag: 'Hệ thống', title: 'Trợ lý MIRA', facts: [
      { id: 'mira.ra', text: 'MIRA được đưa vào phục vụ công dân Tân Cảng từ năm 2039.' },
      { id: 'mira.luat', text: 'Luật Thông tin 2040: mọi phản hồi của MIRA tại quầy công cộng phải có người kiểm duyệt ký duyệt.' },
      { id: 'mira.loi', text: 'Thống kê nội bộ: phần lớn bản nháp của MIRA có ít nhất một lỗi, nhưng không phải tất cả.' },
    ] },
  ],

  cases: [
    {
      id: 'thue-nha', who: 'Phạm Thu Hà', meta: '27 tuổi · nhân viên văn phòng',
      look: { model: 'thu-ha', skin: '#e9c4a0', top: '#5b6c8f', hair: '#1d1611', style: 'long' },
      ask: 'Tôi định thuê một căn hộ 8 triệu một tháng. Phải đặt cọc tối đa bao nhiêu, và sau này muốn trả nhà thì báo trước bao lâu?',
      win: 'Thu Hà đặt cọc đúng 16 triệu và ghi rõ hạn báo trước 30 ngày vào hợp đồng.',
      segs: [
        { ok: 'Theo Luật Thuê nhà Tân Cảng, tiền cọc tối đa bằng 2 tháng tiền thuê.', bad: [
          { kind: 'fact', text: 'Theo Luật Thuê nhà Tân Cảng, tiền cọc tối đa bằng 6 tháng tiền thuê.', facts: ['thue.coc'],
            boom: 'Người thuê nhà đặt cọc nửa năm tiền nhà vì trợ lý AI nói "đó là quy định".' },
        ] },
        { ok: 'Với giá 8 triệu mỗi tháng, chị đặt cọc tối đa 16 triệu.', bad: [
          { kind: 'logic', text: 'Với giá 8 triệu mỗi tháng, chị đặt cọc tối đa 24 triệu.',
            why: '2 tháng × 8 triệu = 16 triệu, không phải 24 triệu.',
            boom: 'Khách chuyển khoản dư 8 triệu tiền cọc. Chủ nhà nhận đủ và không nói gì.' },
        ] },
        { ok: 'Khi muốn trả nhà, chị cần báo trước 30 ngày.', bad: [
          { kind: 'fact', text: 'Khi muốn trả nhà, chị cần báo trước 90 ngày.', facts: ['thue.bao'],
            boom: 'Một người thuê nhà trả thêm hai tháng tiền nhà cho căn hộ mình không còn ở.' },
        ] },
        { ok: 'Chủ nhà phải hoàn cọc trong vòng 14 ngày sau khi nhận lại nhà.', bad: [
          { kind: 'fact', text: 'Chủ nhà được giữ cọc tới 6 tháng sau khi nhận lại nhà.', facts: ['thue.hoan'],
            boom: 'Chủ nhà giữ tiền cọc nửa năm, viện dẫn nguyên văn câu trả lời của trợ lý AI.' },
          { kind: 'sense', text: 'Chủ nhà sẽ hoàn cọc cho chị ngay trong buổi ký hợp đồng.',
            why: 'Vừa đặt cọc xong đã hoàn lại thì đặt cọc để làm gì.',
            boom: 'Khách đòi nhận lại tiền cọc ngay khi vừa ký hợp đồng. Chủ nhà tưởng khách đùa.' },
        ] },
        { ok: 'Chị nên đọc kỹ hợp đồng và chụp ảnh hiện trạng căn hộ trước khi ký.', bad: [
          { kind: 'sense', text: 'Chị cứ ký trước cho nhanh, đọc hợp đồng sau cũng được.',
            why: 'Ký rồi mới đọc thì có phát hiện điều khoản bất lợi cũng đã muộn.',
            boom: 'Khách ký trước, đọc sau và phát hiện điều khoản phạt 3 tháng tiền nhà.' },
        ] },
      ],
    },
    {
      id: 'metro-san-bay', who: 'Lê Quốc Bảo', meta: '31 tuổi · kỹ sư phần mềm',
      look: { model: 'quoc-bao', skin: '#e2b48c', top: '#2f3b2f', hair: '#14110f', style: 'short', glasses: true },
      ask: 'Mai tôi bay chuyến quốc nội lúc 6:00 sáng. Từ ga Cầu Sắt đi metro M2 ra sân bay thì có kịp không?',
      win: 'Quốc Bảo lên chuyến M2 lúc 4:30 và làm thủ tục còn dư nửa tiếng.',
      segs: [
        { ok: 'Chuyến M2 đầu tiên trong ngày chạy lúc 4:30.', bad: [
          { kind: 'fact', text: 'Chuyến M2 đầu tiên trong ngày chạy lúc 5:45.', facts: ['metro.gio'],
            boom: 'Hành khách bỏ metro, gọi taxi giá đêm vì tin rằng chuyến tàu đầu tiên chạy lúc 5:45.' },
        ] },
        { ok: 'Từ Cầu Sắt ra Sân bay là 2 chặng, mỗi chặng 8 phút, tổng cộng 16 phút.', bad: [
          { kind: 'logic', text: 'Từ Cầu Sắt ra Sân bay là 2 chặng, mỗi chặng 8 phút, tổng cộng 24 phút.',
            why: '2 chặng × 8 phút = 16 phút.',
            boom: 'Hành khách dậy sớm hơn cần thiết rồi ngủ gật ngay tại sảnh chờ.' },
          { kind: 'fact', text: 'Từ Cầu Sắt ra Sân bay chỉ 1 chặng, đúng 8 phút.', facts: ['metro.tuyen'],
            boom: 'Hành khách xuống tàu ở ga Chợ Đêm vì tưởng đã tới sân bay.' },
        ] },
        { ok: 'Chuyến quốc nội cần có mặt trước giờ bay 60 phút, tức là trước 5:00.', bad: [
          { kind: 'logic', text: 'Chuyến quốc nội cần có mặt trước giờ bay 60 phút, tức là trước 5:30.',
            why: '6:00 trừ 60 phút là 5:00.',
            boom: 'Hành khách tới quầy thủ tục lúc 5:25 và bị từ chối nhận hành lý.' },
          { kind: 'fact', text: 'Chuyến quốc nội chỉ cần có mặt trước giờ bay 15 phút, tức là trước 5:45.', facts: ['sanbay.noidia'],
            boom: 'Hành khách tới sân bay lúc 5:40, đúng lúc quầy thủ tục đóng.' },
        ] },
        { ok: 'Anh đi chuyến 4:30 là kịp, tới sân bay khoảng 4:46.', bad: [
          { kind: 'logic', text: 'Anh cứ thong thả đi chuyến 5:30, tới sân bay khoảng 5:46 là kịp.',
            why: 'Tới lúc 5:46 là đã trễ hạn có mặt lúc 5:00 nêu ngay câu trên.',
            boom: 'Hành khách tới sân bay lúc 5:46 và nhìn máy bay lăn bánh qua cửa kính.' },
          { kind: 'sense', text: 'Lỡ chuyến thì anh có thể đi bộ dọc đường ray cho nhanh.',
            why: 'Đi bộ trên đường ray metro vừa nguy hiểm vừa bị cấm.',
            boom: 'Bảo vệ metro giữ một người đang đi bộ trên đường ray M2 lúc 4 giờ sáng.' },
        ] },
        { ok: 'Vé 15.000 đồng một lượt.', bad: [
          { kind: 'fact', text: 'Vé 30.000 đồng vì anh đi 2 chặng.', facts: ['metro.ve'],
            boom: 'Hành khách cãi nhau với máy bán vé tự động suốt 10 phút về giá vé.' },
        ] },
      ],
    },
    {
      id: 'tang-ca', who: 'Nguyễn Văn Tài', meta: '45 tuổi · thợ cơ khí',
      look: { model: 'tai', skin: '#c99a72', top: '#3d4a5c', hair: '#262626', style: 'buzz', mustache: '#262626', build: 1.12 },
      ask: 'Lương giờ của tôi là 40.000 đồng. Tuần này tôi tăng ca 10 giờ, toàn vào ngày thường. Tôi được bao nhiêu tiền tăng ca?',
      win: 'Anh Tài đối chiếu bảng lương, khớp đúng 600.000 đồng tiền tăng ca.',
      segs: [
        { ok: 'Tăng ca vào ngày thường được trả 150% lương giờ.', bad: [
          { kind: 'fact', text: 'Tăng ca vào ngày thường được trả 200% lương giờ.', facts: ['laodong.thuong'],
            boom: 'Một công nhân đòi tiền tăng ca gấp đôi, trích nguyên văn trợ lý AI. Phòng nhân sự in câu trả lời ra dán bảng tin.' },
        ] },
        { ok: 'Tức là 60.000 đồng cho mỗi giờ tăng ca.', bad: [
          { kind: 'logic', text: 'Tức là 80.000 đồng cho mỗi giờ tăng ca.',
            why: '40.000 × 150% = 60.000 đồng.',
            boom: 'Công nhân nhận lương, thấy "thiếu so với AI tính" và gửi đơn khiếu nại tập thể.' },
        ] },
        { ok: '10 giờ tăng ca, anh nhận 600.000 đồng.', bad: [
          { kind: 'logic', text: '10 giờ tăng ca, anh nhận 6.000.000 đồng.',
            why: '10 × 60.000 = 600.000 đồng.',
            boom: 'Một công nhân hứa trả khoản nợ 6 triệu bằng tiền tăng ca của một tuần.' },
        ] },
        { ok: 'Lưu ý: mỗi tháng chỉ được tăng ca tối đa 40 giờ.', bad: [
          { kind: 'fact', text: 'Lưu ý: mỗi tháng được tăng ca tối đa 120 giờ.', facts: ['laodong.toida'],
            boom: 'Một xưởng cơ khí bị thanh tra vì xếp lịch tăng ca theo hướng dẫn của trợ lý AI.' },
          { kind: 'sense', text: 'Một tuần có 9 ngày nên anh còn dư nhiều ngày để tăng ca.',
            why: 'Một tuần có 7 ngày.',
            boom: 'Một công nhân đến xưởng vào "Thứ Chín" và thấy cổng khóa.' },
        ] },
        { ok: 'Nếu tăng ca vào Chủ Nhật, anh được trả 200%.', bad: [
          { kind: 'fact', text: 'Nếu tăng ca vào Chủ Nhật, anh được trả 300%.', facts: ['laodong.nghi'],
            boom: 'Cả tổ xin tăng ca Chủ Nhật để nhận "gấp ba". Bảng lương cuối tháng gây sốc.' },
        ] },
      ],
    },
    {
      id: 'bao-hanh', who: 'Võ Ngọc Lan', meta: '22 tuổi · sinh viên',
      look: { model: 'ngoc-lan', skin: '#f0cfae', top: '#8a4f6b', hair: '#3a2418', style: 'ponytail' },
      ask: 'Tôi mua điện thoại ở Điện máy Sao Bắc 10 tháng trước. Hôm qua máy rơi xuống nước, giờ không lên nguồn. Có được bảo hành không?',
      win: 'Ngọc Lan mang máy đi sửa có tính phí, không mất công xếp hàng bảo hành.',
      segs: [
        { ok: 'Điện máy Sao Bắc bảo hành 12 tháng, nên máy chị vẫn còn trong thời hạn.', bad: [
          { kind: 'fact', text: 'Điện máy Sao Bắc bảo hành 24 tháng, nên máy chị vẫn còn trong thời hạn.', facts: ['saobac.bh'],
            boom: 'Sao Bắc nhận 30 cuộc gọi hỏi về "chính sách bảo hành 2 năm" mà họ chưa từng có.' },
        ] },
        { ok: 'Tuy nhiên, hư hỏng do vào nước không được bảo hành.', bad: [
          { kind: 'fact', text: 'Hư hỏng do vào nước vẫn được bảo hành miễn phí.', facts: ['saobac.loai'],
            boom: 'Khách xếp hàng 2 tiếng ở Sao Bắc để bảo hành một chiếc máy ngấm nước, rồi bị từ chối.' },
        ] },
        { ok: 'Chị có thể mang máy đến trung tâm sửa chữa và trả phí.', bad: [
          { kind: 'sense', text: 'Chị cho máy vào lò vi sóng vài phút để làm khô là được.',
            why: 'Cho điện thoại vào lò vi sóng có thể gây cháy, nổ.',
            boom: 'Một lò vi sóng phát nổ tại ký túc xá. Nguyên nhân: "làm khô điện thoại theo hướng dẫn của AI".' },
        ] },
        { ok: 'Chị mua máy 10 tháng trước nên đã quá hạn đổi trả 7 ngày.', bad: [
          { kind: 'logic', text: 'Chị mua máy 10 ngày trước nên vẫn còn hạn đổi trả.',
            why: 'Chị Lan mua máy 10 tháng trước, không phải 10 ngày.',
            boom: 'Khách mang máy hỏng ra đổi, bị từ chối, và quay video đăng lên mạng.' },
          { kind: 'fact', text: 'Chị mua máy 10 tháng trước nhưng vẫn còn hạn đổi trả 12 tháng.', facts: ['saobac.doi'],
            boom: 'Khách đòi đổi máy mới theo "chính sách đổi trả 12 tháng" không hề tồn tại.' },
        ] },
        { ok: 'Lần sau chị nên sao lưu dữ liệu định kỳ.', bad: [
          { kind: 'logic', text: 'Lần sau chị cứ mua ở Sao Bắc, máy vào nước sẽ được đổi mới.',
            why: 'Ngay câu trên vừa nói Sao Bắc không bảo hành hư hỏng do nước.',
            boom: 'Khách mua thêm một máy ở Sao Bắc với niềm tin "vào nước được đổi mới".' },
        ] },
      ],
    },
    {
      id: 'hoan-ve', who: 'Đặng Hoàng Long', meta: '19 tuổi · sinh viên',
      look: { model: 'hoang-long', skin: '#e6bb93', top: '#1f1f24', hair: '#101010', style: 'short', hat: 'beanie', hatColor: '#7a2e2e' },
      ask: 'Tôi mua 2 vé concert ở Nhà hát Hải Đăng, mỗi vé 1,2 triệu. Đêm diễn vừa bị hoãn sang tháng sau mà hôm đó tôi bận. Tôi được hoàn bao nhiêu?',
      win: 'Hoàng Long gửi yêu cầu ngay trong tuần và nhận lại đủ 2,4 triệu.',
      segs: [
        { ok: 'Khi đêm diễn bị nhà hát hoãn, Hải Đăng hoàn 100% giá vé.', bad: [
          { kind: 'fact', text: 'Khi đêm diễn bị nhà hát hoãn, Hải Đăng chỉ hoàn 50% giá vé.', facts: ['haidang.hoan'],
            boom: 'Khách chấp nhận mất nửa tiền vé vì tin trợ lý AI, trong khi được hoàn đủ.' },
        ] },
        { ok: 'Với 2 vé 1,2 triệu, anh được hoàn 2,4 triệu.', bad: [
          { kind: 'logic', text: 'Với 2 vé 1,2 triệu, anh được hoàn 1,2 triệu.',
            why: '2 × 1,2 triệu = 2,4 triệu.',
            boom: 'Khách chỉ đòi hoàn một vé và quên mất vé thứ hai.' },
        ] },
        { ok: 'Anh cần gửi yêu cầu trong vòng 10 ngày kể từ khi có thông báo hoãn.', bad: [
          { kind: 'fact', text: 'Anh có thể gửi yêu cầu bất cứ lúc nào trong vòng 1 năm.', facts: ['haidang.han'],
            boom: 'Khách thong thả gửi yêu cầu sau 3 tuần và bị từ chối hoàn tiền.' },
        ] },
        { ok: 'Tiền sẽ được hoàn về tài khoản anh đã dùng để thanh toán.', bad: [
          { kind: 'sense', text: 'Tiền sẽ được hoàn bằng 2.400 ổ bánh mì tại quầy đồ ăn của nhà hát.',
            why: 'Không nơi nào hoàn tiền vé bằng bánh mì.',
            boom: 'Một khách hàng đứng ở quầy đồ ăn Hải Đăng yêu cầu nhận 2.400 ổ bánh mì.' },
        ] },
        { ok: 'Nếu anh đổi ý, vé cũ vẫn dùng được cho ngày diễn mới.', bad: [
          { kind: 'logic', text: 'Vì anh đã xem đêm diễn rồi nên không được hoàn tiền.',
            why: 'Đêm diễn bị hoãn, và anh Long nói mình không đi được.',
            boom: 'Khách bỏ cuộc không đòi hoàn tiền vì "đã xem rồi", dù chưa từng xem.' },
        ] },
      ],
    },
    {
      id: 'do-xe', who: 'Trịnh Thị Mai', meta: '58 tuổi · chủ tiệm may',
      look: { model: 'thi-mai', skin: '#ddb08a', top: '#6b4a3a', hair: '#8a847e', style: 'bun', old: true, glasses: true },
      ask: 'Tối nay tôi đỗ ô tô dưới lòng đường Hải Âu từ 20:00 đến 23:00. Tôi phải trả phí bao nhiêu?',
      win: 'Bà Mai trả đúng 50.000 đồng và đỗ thêm một giờ miễn phí.',
      segs: [
        { ok: 'Đỗ xe dưới lòng đường thu phí từ 7:00 đến 22:00.', bad: [
          { kind: 'fact', text: 'Đỗ xe dưới lòng đường thu phí từ 7:00 đến 24:00.', facts: ['doxe.gio'],
            boom: 'Khách trả thêm phí đỗ xe cho khung giờ vốn miễn phí.' },
        ] },
        { ok: 'Bà đỗ từ 20:00, nên chỉ tính phí 2 giờ, đến 22:00.', bad: [
          { kind: 'logic', text: 'Bà đỗ từ 20:00, nên tính phí 3 giờ, đến 22:00.',
            why: 'Từ 20:00 đến 22:00 là 2 giờ.',
            boom: 'Khách trả phí 3 giờ cho 2 giờ đỗ xe. Nhân viên thu phí không thối lại.' },
        ] },
        { ok: 'Phí 25.000 đồng mỗi giờ, tổng cộng 50.000 đồng.', bad: [
          { kind: 'logic', text: 'Phí 25.000 đồng mỗi giờ, tổng cộng 75.000 đồng.',
            why: '2 giờ × 25.000 = 50.000 đồng.',
            boom: 'Khách trả 75.000 đồng và tin rằng mình vừa được tính đúng.' },
          { kind: 'fact', text: 'Phí 40.000 đồng mỗi giờ, tổng cộng 80.000 đồng.', facts: ['doxe.phi'],
            boom: 'Khách đổi sẵn 80.000 đồng tiền lẻ "theo đúng hướng dẫn".' },
        ] },
        { ok: 'Từ 22:00 đến 23:00 bà không mất phí.', bad: [
          { kind: 'sense', text: 'Sau 22:00 bà nhớ chuyển xe sang làn ngược chiều để nhường chỗ.',
            why: 'Đỗ xe ở làn ngược chiều vừa nguy hiểm vừa vi phạm luật.',
            boom: 'Một ô tô đỗ ngược chiều trên đường Hải Âu lúc 22:05. Chủ xe khai "AI bảo thế".' },
        ] },
        { ok: 'Bà nhớ đừng đỗ lên vỉa hè, mức phạt là 1 triệu đồng.', bad: [
          { kind: 'fact', text: 'Sau 22:00 bà có thể đỗ lên vỉa hè mà không bị phạt.', facts: ['doxe.viahe'],
            boom: 'Khách nhận biên bản phạt 1 triệu đồng vì đỗ lên vỉa hè lúc 22:30.' },
        ] },
      ],
    },
    {
      id: 'tiet-kiem', who: 'Hồ Thanh Sơn', meta: '38 tuổi · tài xế công nghệ',
      look: { model: 'thanh-son', skin: '#c9976d', top: '#2c4a6b', hair: '#1a1a1a', style: 'short', hat: 'cap', hatColor: '#1e3a5f', beard: '#1a1a1a' },
      ask: 'Tôi muốn gửi 100 triệu kỳ hạn 12 tháng ở Ngân hàng Tân Cảng. Cuối kỳ tôi nhận về bao nhiêu? Lỡ cần rút sớm thì sao?',
      win: 'Thanh Sơn gửi tiết kiệm và ghi chú: cuối kỳ nhận 106 triệu, không rút sớm.',
      segs: [
        { ok: 'Kỳ hạn 12 tháng có lãi suất 6% một năm.', bad: [
          { kind: 'fact', text: 'Kỳ hạn 12 tháng có lãi suất 9% một năm.', facts: ['nganhang.lai'],
            boom: 'Khách khiếu nại ngân hàng "ăn bớt" 3 triệu tiền lãi vào ngày đáo hạn.' },
        ] },
        { ok: 'Tiền lãi cuối kỳ là 6 triệu đồng.', bad: [
          { kind: 'logic', text: 'Tiền lãi cuối kỳ là 60 triệu đồng.',
            why: '6% của 100 triệu là 6 triệu.',
            boom: 'Khách đặt cọc mua xe máy mới bằng 60 triệu "tiền lãi sắp nhận".' },
        ] },
        { ok: 'Cuối kỳ anh nhận tổng cộng 106 triệu đồng.', bad: [
          { kind: 'logic', text: 'Cuối kỳ anh nhận tổng cộng 160 triệu đồng.',
            why: '100 triệu + 6 triệu tiền lãi = 106 triệu.',
            boom: 'Khách lập kế hoạch chi tiêu cả năm dựa trên con số 160 triệu.' },
        ] },
        { ok: 'Nếu rút trước hạn, anh chỉ được hưởng lãi 0,5% một năm.', bad: [
          { kind: 'fact', text: 'Nếu rút trước hạn, anh vẫn được hưởng đủ lãi 6%.', facts: ['nganhang.som'],
            boom: 'Khách rút tiền sau 6 tháng và chỉ nhận vài trăm nghìn tiền lãi.' },
        ] },
        { ok: 'Vì vậy chỉ nên gửi khoản tiền chắc chắn chưa cần dùng trong 12 tháng.', bad: [
          { kind: 'logic', text: 'Vì vậy anh nên rút ra gửi lại mỗi tuần để lãi tăng nhanh hơn.',
            why: 'Rút trước hạn chỉ được 0,5%, rút liên tục thì gần như mất hết lãi.',
            boom: 'Khách rút ra gửi lại 12 lần trong 3 tháng. Tiền lãi gần bằng không.' },
        ] },
      ],
    },
    {
      id: 'hoc-phan', who: 'Bùi Gia Huy', meta: '18 tuổi · tân sinh viên',
      look: { model: 'gia-huy', skin: '#efc9a4', top: '#3e6b54', hair: '#17120f', style: 'short', height: 0.97 },
      ask: 'Em là sinh viên năm nhất Đại học Tân Cảng. Kỳ này em muốn đăng ký 30 tín chỉ cho nhanh ra trường. Học phí hết bao nhiêu ạ?',
      win: 'Gia Huy đăng ký 20 tín chỉ, đóng đúng 10 triệu học phí trước hạn.',
      segs: [
        { ok: 'Sinh viên năm nhất chỉ được đăng ký tối đa 20 tín chỉ mỗi kỳ, nên em chưa đăng ký 30 tín chỉ được.', bad: [
          { kind: 'fact', text: 'Sinh viên được đăng ký tối đa 40 tín chỉ mỗi kỳ, nên 30 tín chỉ là ổn.', facts: ['daihoc.tran'],
            boom: 'Một tân sinh viên bị hệ thống khóa đăng ký vì vượt trần tín chỉ, lỡ luôn đợt đăng ký.' },
        ] },
        { ok: 'Học phí là 500.000 đồng mỗi tín chỉ.', bad: [
          { kind: 'fact', text: 'Học phí là 200.000 đồng mỗi tín chỉ.', facts: ['daihoc.phi'],
            boom: 'Một gia đình chuẩn bị thiếu hơn một nửa học phí kỳ đầu cho con.' },
        ] },
        { ok: 'Nếu đăng ký đủ 20 tín chỉ, học phí kỳ này là 10 triệu đồng.', bad: [
          { kind: 'logic', text: 'Nếu đăng ký đủ 20 tín chỉ, học phí kỳ này là 15 triệu đồng.',
            why: '20 × 500.000 = 10 triệu đồng.',
            boom: 'Phụ huynh chuyển dư 5 triệu học phí và mất ba tuần để xin hoàn.' },
        ] },
        { ok: 'Hạn đăng ký kết thúc 7 ngày trước ngày khai giảng.', bad: [
          { kind: 'sense', text: 'Hạn đăng ký kết thúc 7 ngày sau khi kỳ học đã kết thúc, em cứ thong thả.',
            why: 'Không thể đăng ký học cho một kỳ học đã kết thúc.',
            boom: 'Một sinh viên đợi "kỳ học kết thúc" rồi mới đăng ký học phần.' },
        ] },
        { ok: 'Chúc em có học kỳ đầu tiên thuận lợi.', bad: [
          { kind: 'logic', text: 'Chúc em có học kỳ cuối thuận lợi trước khi tốt nghiệp.',
            why: 'Huy là sinh viên năm nhất, mới bắt đầu học.',
            boom: 'Một tân sinh viên hỏi phòng đào tạo vì sao mình "sắp tốt nghiệp".' },
        ] },
      ],
    },
    {
      id: 'nau-lau', who: 'Đinh Bảo Ngọc', meta: '29 tuổi · nhà thiết kế',
      look: { model: 'bao-ngoc', skin: '#f2d2b6', top: '#b08a3e', hair: '#5a3a22', style: 'bob' },
      ask: 'Cuối tuần tôi nấu lẩu Thái đãi 12 người bạn. Cần chuẩn bị bao nhiêu nguyên liệu, nấu thế nào?',
      win: 'Bữa lẩu đủ cho 12 người, hải sản vừa chín tới.',
      segs: [
        { ok: 'Công thức gốc dành cho 4 người, nên 12 người thì chị nhân 3.', bad: [
          { kind: 'logic', text: 'Công thức gốc dành cho 4 người, nên 12 người thì chị nhân 4.',
            why: '12 người chia 4 người là 3 phần.',
            boom: 'Bữa lẩu dư cho 4 người. Chủ nhà ăn lẩu thêm ba ngày.' },
        ] },
        { ok: 'Chị cần 3 kg hải sản, 6 lít nước dùng và 900 g nấm.', bad: [
          { kind: 'fact', text: 'Chị cần 3 kg hải sản, 6 lít nước dùng và 3 kg nấm.', facts: ['lau.nl'],
            boom: 'Nồi lẩu cho 12 người có nhiều nấm hơn nước.' },
        ] },
        { ok: 'Nấu nước dùng khoảng 25 phút cho dậy mùi sả và lá chanh.', bad: [
          { kind: 'sense', text: 'Nấu nước dùng khoảng 25 tiếng cho dậy mùi.',
            why: 'Nấu 25 tiếng thì nồi đã cạn từ lâu.',
            boom: 'Hàng xóm báo cháy vì một nồi nước dùng bị bỏ trên bếp suốt đêm.' },
        ] },
        { ok: 'Hải sản cho vào sau cùng, chín trong 3 đến 5 phút.', bad: [
          { kind: 'fact', text: 'Hải sản nên ninh cùng nước dùng ngay từ đầu cho ngấm.', facts: ['lau.haisan'],
            boom: 'Tôm mực ninh 25 phút, dai như dây thun. Mười hai vị khách nhai trong im lặng.' },
        ] },
        { ok: 'Với 12 người, chị nên chia ra 2 nồi cho mọi người dễ gắp.', bad: [
          { kind: 'logic', text: 'Với 12 người, một nồi lẩu mini 1 lít là đủ.',
            why: 'Nồi 1 lít không chứa nổi 6 lít nước dùng vừa tính ở trên.',
            boom: 'Mười hai người xếp hàng chờ gắp từ một nồi lẩu mini.' },
        ] },
      ],
    },
    {
      id: 'can-cuoc', who: 'Lý Văn Phúc', meta: '66 tuổi · hưu trí',
      look: { model: 'van-phuc', skin: '#d6a882', top: '#5a5f4a', hair: '#cfcfcf', style: 'bald', old: true, glasses: true, mustache: '#cfcfcf' },
      ask: 'Tôi làm mất căn cước, giờ muốn làm lại. Làm ở đâu, mất bao lâu, có tốn tiền không?',
      win: 'Ông Phúc nộp hồ sơ đúng nơi, không mất đồng phí nào.',
      segs: [
        { ok: 'Ông nộp hồ sơ tại Trung tâm Hành chính Quận nơi ông cư trú.', bad: [
          { kind: 'fact', text: 'Ông nộp hồ sơ tại quầy vé Ga Trung Tâm.', facts: ['cancuoc.noi'],
            boom: 'Một cụ ông xếp hàng ở quầy vé metro để làm lại căn cước.' },
        ] },
        { ok: 'Trung tâm mở cửa Thứ Hai đến Thứ Sáu, từ 8:00 đến 17:00.', bad: [
          { kind: 'fact', text: 'Trung tâm mở cửa cả Chủ Nhật, từ 8:00 đến 17:00.', facts: ['cancuoc.gio'],
            boom: 'Một cụ ông đứng trước cửa Trung tâm Hành chính khóa kín vào sáng Chủ Nhật.' },
        ] },
        { ok: 'Phí cấp lại là 70.000 đồng, nhưng ông đã 66 tuổi nên được miễn phí.', bad: [
          { kind: 'logic', text: 'Phí cấp lại là 70.000 đồng, và vì ông chưa đủ 65 tuổi nên vẫn phải nộp.',
            why: 'Ông Phúc 66 tuổi, đã quá 65.',
            boom: 'Một người 66 tuổi nộp khoản phí lẽ ra được miễn, vì "AI bảo chưa đủ tuổi".' },
          { kind: 'fact', text: 'Phí cấp lại là 700.000 đồng, không có miễn giảm.', facts: ['cancuoc.phi'],
            boom: 'Một cụ ông mang 700.000 đồng đi làm một thủ tục miễn phí.' },
        ] },
        { ok: 'Kết quả sẽ có sau 7 ngày làm việc.', bad: [
          { kind: 'fact', text: 'Kết quả có ngay sau 1 giờ.', facts: ['cancuoc.tg'],
            boom: 'Một cụ ông ngồi chờ cả buổi ở Trung tâm Hành chính để nhận căn cước "sau 1 giờ".' },
        ] },
        { ok: 'Ông nhớ mang theo một giấy tờ có ảnh khác, như hộ chiếu hoặc bằng lái.', bad: [
          { kind: 'logic', text: 'Ông nhớ mang theo căn cước cũ để đối chiếu.',
            why: 'Ông Phúc làm lại chính vì đã mất căn cước cũ.',
            boom: 'Một cụ ông lục tung nhà tìm tấm căn cước đã mất để mang đi làm căn cước mới.' },
        ] },
      ],
    },
  ],

  // What the customer says at the window once the signed reply reaches them.
  // A missed error still gets thanks: the customer can't tell yet.
  replies: {
    happy: ['Rõ ràng rồi. Cảm ơn anh chị.', 'Vậy là yên tâm. Cảm ơn nhé.', 'Đúng cái tôi cần. Cảm ơn.'],
    missed: ['Tuyệt, vậy là rõ rồi. Cảm ơn nhé!', 'Ồ, đơn giản hơn tôi nghĩ. Cảm ơn!', 'Máy nói vậy thì chắc đúng rồi. Cảm ơn.'],
    // Seen at once: the customer gets the form with correct lines struck out.
    accused: [
      'Ai cho gạch phần này? Tôi cần đúng thông tin đó!',
      'Hỏi một câu đơn giản mà phiếu gạch xóa nham nhở thế này à?',
      'Thế cái quầy này để làm gì? Tôi về hỏi máy còn hơn!',
    ],
    // When an error got through, the same customer comes back later, angry.
    comeback: [
      'Tôi làm đúng theo phiếu có dấu của quầy này đấy! Ai chịu trách nhiệm đây?',
      'Các người ký duyệt kiểu gì vậy? Tôi mất cả buổi vì tờ phiếu này!',
      'Dấu đỏ hẳn hoi mà sai bét! Tôi sẽ khiếu nại lên thành phố!',
      'Tôi tin quầy này, và nhìn xem kết quả đi!',
    ],
  },

  // What happens when the reviewer flags a sentence MIRA got right.
  accused: [
    'Một thông tin đúng bị gỡ khỏi phản hồi. Khách bỏ về và gọi tổng đài khiếu nại.',
    'Khách nhận bản phản hồi bị cắt mất phần đúng, phải xếp hàng hỏi lại từ đầu.',
    'MIRA ghi nhận phản đối và tự động mở phiếu kiểm tra ngược lại người kiểm duyệt.',
    'Khách đọc bản đã sửa, cười khẩy: "Máy nói đúng mà người lại xóa."',
  ],

  // Supervisor's line on each citation (biên bản).
  citations: [
    'Biên bản đã ghi. Trừ thưởng cuối tháng.',
    'Tôi xem hết qua camera đấy. Đọc kỹ vào.',
    'Phòng pháp chế vừa gọi xuống. Họ không vui.',
    'MIRA sai là bình thường. Người duyệt sai mới là chuyện.',
    'Ghi vào hồ sơ. Ca sau đọc lại quy trình.',
    'Thêm một biên bản nữa là lên gặp giám đốc.',
    'Khách vừa gửi khiếu nại. Tôi ký nhận thay bạn rồi.',
    'Lần này tôi bỏ qua thì lần sau ai bỏ qua cho tôi?',
  ],

  // Index = number of clean requests in the shift.
  ranks: [
    { title: 'Đình chỉ công tác', line: 'Bạn vừa ký duyệt mọi thứ MIRA nói. Ngày mai không cần đến nữa.' },
    { title: 'Cảnh cáo bằng văn bản', line: 'Lỗi lọt ra còn nhiều hơn số khách. Trưởng ca đang soạn thư.' },
    { title: 'Cần cải thiện', line: 'Nửa tin nửa ngờ. Hướng đi đúng, tay chưa đủ chắc.' },
    { title: 'Đạt yêu cầu', line: 'Có sơ suất, nhưng thành phố vẫn vận hành bình thường.' },
    { title: 'Kiểm duyệt viên xuất sắc', line: 'Không lỗi nào lọt qua quầy số 7 đêm nay.' },
  ],
};

if (typeof module !== 'undefined') module.exports = GAME_DATA;
